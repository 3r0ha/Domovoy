import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createResilientClient, type RuntimeHooks } from '../dist/index.js';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Подставной fetch: отдаёт заранее заданные ответы и записывает, что у него спросили. */
const createFetchStub = (responses: (Response | Error | 'hang')[]) => {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      headers,
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });

    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;

    if (next === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    }

    if (next instanceof Error) return Promise.reject(next);
    if (!next) return Promise.reject(new Error('ответов больше нет'));

    return Promise.resolve(next.clone());
  };

  return { fetchStub: fetchStub, calls };
};

const json = (data: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

const fastRetry = { baseDelayMs: 1, jitter: false } as const;

describe('сборка запроса', () => {
  it('подставляет путь, экранируя значения', async () => {
    const { fetchStub, calls } = createFetchStub([json({ ok: true })]);
    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false });

    await client.call({ method: 'chats/{chatId}/members', options: { path: { chatId: 'a/b?c' } } });

    assert.equal(calls[0]?.url, 'https://platform-api2.max.ru/chats/a%2Fb%3Fc/members');
  });

  it('сохраняет ложные, но осмысленные параметры запроса', async () => {
    const { fetchStub, calls } = createFetchStub([json({ ok: true })]);
    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false });

    await client.call({
      method: 'messages',
      options: {
        method: 'POST',
        query: { count: 0, disable_link_preview: false, marker: '', chat_id: 42, skip: undefined, other: null },
      },
    });

    const url = new URL(calls[0]!.url);
    assert.equal(url.searchParams.get('count'), '0');
    assert.equal(url.searchParams.get('disable_link_preview'), 'false');
    assert.equal(url.searchParams.get('marker'), '');
    assert.equal(url.searchParams.get('chat_id'), '42');
    assert.equal(url.searchParams.has('skip'), false);
    assert.equal(url.searchParams.has('other'), false);
  });

  it('передаёт токен заголовком и ставит content-type только при теле', async () => {
    const { fetchStub, calls } = createFetchStub([json({ ok: true }), json({ ok: true })]);
    const client = createResilientClient('secret-token', { fetch: fetchStub, rateLimit: false });

    await client.call({ method: 'me', options: {} });
    await client.call({ method: 'messages', options: { method: 'POST', body: { text: 'привет' } } });

    assert.equal(calls[0]?.headers['Authorization'], 'secret-token');
    assert.equal(calls[0]?.headers['content-type'], undefined);
    assert.equal(calls[1]?.headers['content-type'], 'application/json');
    assert.equal(calls[1]?.body, JSON.stringify({ text: 'привет' }));
  });

  it('не ходит в сеть без токена', async () => {
    const { fetchStub, calls } = createFetchStub([json({ ok: true })]);
    const client = createResilientClient('', { fetch: fetchStub, rateLimit: false });

    const result = await client.call({ method: 'me', options: {} });

    assert.equal(result.status, 401);
    assert.equal(calls.length, 0);
  });
});

describe('разбор ответа', () => {
  it('возвращает статус и тело как есть', async () => {
    const { fetchStub } = createFetchStub([json({ user_id: 7 })]);
    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false });

    const result = await client.call({ method: 'me', options: {} });

    assert.deepEqual(result, { status: 200, data: { user_id: 7 } });
  });

  it('нормализует 401', async () => {
    const { fetchStub } = createFetchStub([new Response('', { status: 401 })]);
    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false });

    const result = await client.call({ method: 'me', options: {} });

    assert.deepEqual(result, { status: 401, data: { code: 'verify.token', message: 'Invalid access_token' } });
  });

  it('пустое тело не считается ошибкой разбора', async () => {
    const { fetchStub } = createFetchStub([new Response(null, { status: 204 })]);
    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false });

    const result = await client.call({ method: 'messages', options: { method: 'DELETE' } });

    assert.deepEqual(result, { status: 204, data: {} });
  });

  it('сообщает о неразобранном ответе', async () => {
    const { fetchStub } = createFetchStub([
      new Response('<html>502</html>', { status: 400, headers: { 'content-type': 'text/html' } }),
    ]);
    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false });

    const result = await client.call({ method: 'me', options: {} });

    assert.equal(result.status, 400);
    assert.equal((result.data as { code: string }).code, 'unexpected.response');
  });
});

describe('повторы', () => {
  it('повторяет идемпотентный запрос после 500 и отдаёт успешный ответ', async () => {
    const { fetchStub, calls } = createFetchStub([
      new Response('{}', { status: 500 }),
      json({ user_id: 1 }),
    ]);
    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false, retry: fastRetry });

    const result = await client.call({ method: 'me', options: { method: 'GET' } });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
  });

  it('не повторяет отправку сообщения после 500', async () => {
    const { fetchStub, calls } = createFetchStub([new Response('{}', { status: 500 })]);
    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false, retry: fastRetry });

    const result = await client.call({ method: 'messages', options: { method: 'POST', body: { text: 'раз' } } });

    assert.equal(result.status, 500);
    assert.equal(calls.length, 1, 'дубль сообщения хуже, чем ошибка');
  });

  it('повторяет отправку сообщения после 429 и уважает Retry-After', async () => {
    const { fetchStub, calls } = createFetchStub([
      new Response('{}', { status: 429, headers: { 'retry-after': '0' } }),
      json({ message: { body: { mid: 'm1' } } }),
    ]);
    const delays: number[] = [];
    const hooks: RuntimeHooks = { onRetry: ({ delayMs }) => void delays.push(delayMs) };
    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false, retry: fastRetry, hooks });

    const result = await client.call({ method: 'messages', options: { method: 'POST', body: {} } });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [0], 'задержка взята из Retry-After, а не из своей формулы');
  });

  it('429 без Retry-After всё равно придерживает очередь', async () => {
    const { fetchStub } = createFetchStub([
      new Response('{}', { status: 429 }),
      json({ message: { body: { mid: 'm1' } } }),
    ]);

    let clock = 0;
    const waits: number[] = [];

    const client = createResilientClient('token', {
      fetch: fetchStub,
      retry: { ...fastRetry, jitter: false, baseDelayMs: 40 },
      rateLimit: {
        rps: 1000,
        now: () => clock,
        sleep: async (ms) => {
          waits.push(ms);
          clock += ms;
        },
      },
    });

    const result = await client.call({ method: 'messages', options: { method: 'POST', body: {} } });

    assert.equal(result.status, 200);
    assert.ok(
      waits.some((ms) => ms >= 39),
      `лимитер не придержал очередь: ${waits.join(', ')}`,
    );
  });

  it('повторяет обрыв сети для GET и в итоге пробрасывает ошибку', async () => {
    const { fetchStub, calls } = createFetchStub([new TypeError('fetch failed')]);
    const client = createResilientClient('token', {
      fetch: fetchStub,
      rateLimit: false,
      retry: { ...fastRetry, attempts: 3 },
    });

    await assert.rejects(client.call({ method: 'me', options: { method: 'GET' } }), TypeError);
    assert.equal(calls.length, 3, 'три попытки, как задано');
  });

  it('не повторяет запрос, отменённый вызывающим кодом', async () => {
    const { fetchStub, calls } = createFetchStub(['hang']);
    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false, retry: fastRetry });
    const controller = new AbortController();

    const pending = client.call({ method: 'me', options: { method: 'GET', signal: controller.signal } });
    controller.abort(new Error('экран закрыт'));

    await assert.rejects(pending, /экран закрыт/);
    assert.equal(calls.length, 1);
  });

  it('прерывает зависший запрос по таймауту', async () => {
    const { fetchStub } = createFetchStub(['hang']);
    const client = createResilientClient('token', {
      fetch: fetchStub,
      rateLimit: false,
      timeoutMs: 20,
      retry: { attempts: 1 },
    });

    await assert.rejects(client.call({ method: 'me', options: { method: 'GET' } }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, 'TimeoutError');
      return true;
    });
  });
});

describe('наблюдаемость', () => {
  it('сообщает о запросе, ответе и повторе', async () => {
    const { fetchStub } = createFetchStub([new Response('{}', { status: 503 }), json({ ok: true })]);
    const events: string[] = [];
    const hooks: RuntimeHooks = {
      onRequest: ({ attempt }) => void events.push(`request:${attempt}`),
      onResponse: ({ status }) => void events.push(`response:${status}`),
      onRetry: ({ status }) => void events.push(`retry:${status}`),
      onFailure: () => void events.push('failure'),
    };

    const client = createResilientClient('token', { fetch: fetchStub, rateLimit: false, retry: fastRetry, hooks });
    await client.call({ method: 'me', options: { method: 'GET' } });

    assert.deepEqual(events, ['request:1', 'response:503', 'retry:503', 'request:2', 'response:200']);
  });

  it('сообщает об окончательной неудаче', async () => {
    const { fetchStub } = createFetchStub([new TypeError('fetch failed')]);
    const failures: unknown[] = [];
    const client = createResilientClient('token', {
      fetch: fetchStub,
      rateLimit: false,
      retry: { attempts: 1 },
      hooks: { onFailure: ({ error }) => void failures.push(error) },
    });

    await assert.rejects(client.call({ method: 'me', options: { method: 'GET' } }));
    assert.equal(failures.length, 1);
  });

  it('сообщает об ожидании в очереди лимитера', async () => {
    const { fetchStub } = createFetchStub([json({ ok: true })]);
    const waits: number[] = [];

    let now = 1_000_000;
    const client = createResilientClient('token', {
      fetch: fetchStub,
      rateLimit: {
        rps: 10,
        burst: 1,
        now: () => now,
        sleep: async (ms: number) => {
          now += ms;
        },
      },
      hooks: { onRateLimitWait: ({ waitedMs }) => void waits.push(waitedMs) },
    });

    await client.call({ method: 'me', options: {} });
    await client.call({ method: 'me', options: {} });

    assert.deepEqual(waits, [100], 'второй запрос подождал свой слот');
  });
});
