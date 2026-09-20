import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { libreTranslator, machineTranslatorFromEnv, myMemoryTranslator } from '../dist/machine-translator.js';

interface Call {
  url: string;
  body?: unknown;
}

const stub = (reply: { body?: unknown; status?: number; fail?: boolean }) => {
  const calls: Call[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      ...(init?.body === undefined ? {} : { body: init.body }),
    });

    if (reply.fail) return Promise.reject(new Error('сеть недоступна'));

    return Promise.resolve(
      new Response(reply.status !== undefined && reply.status >= 400 ? null : JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { calls, fetch: fetchStub };
};

describe('LibreTranslate', () => {
  it('шлёт текст, языки и ключ на /translate', async () => {
    const { calls, fetch } = stub({ body: { translatedText: 'Hot water shutdown' } });
    const machine = libreTranslator({ url: 'http://libre.test:5000/', apiKey: 'k1', fetch });

    const said = await machine.translate(['Отключение горячей воды'], 'en', 'ru');

    assert.deepEqual(said, ['Hot water shutdown']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://libre.test:5000/translate');

    const body = JSON.parse(String(calls[0]?.body)) as Record<string, unknown>;

    assert.equal(body['q'], 'Отключение горячей воды');
    assert.equal(body['source'], 'ru');
    assert.equal(body['target'], 'en');
    assert.equal(body['format'], 'text');
    assert.equal(body['api_key'], 'k1');
  });

  it('без ключа его в запросе нет', async () => {
    const { calls, fetch } = stub({ body: { translatedText: 'Lift is broken' } });

    await libreTranslator({ url: 'http://libre.test:5000', fetch }).translate(['Лифт сломан'], 'en', 'ru');

    assert.equal(Object.hasOwn(JSON.parse(String(calls[0]?.body)) as object, 'api_key'), false);
  });

  it('отказ службы отдаётся пустым переводом, а не исключением', async () => {
    const { fetch } = stub({ fail: true });
    const errors: unknown[] = [];

    const said = await libreTranslator({
      url: 'http://libre.test:5000',
      fetch,
      onError: (error) => errors.push(error),
    }).translate(['Лифт сломан'], 'en', 'ru');

    assert.deepEqual(said, [undefined]);
    assert.equal(errors.length, 1);
  });

  it('ответ с кодом ошибки тоже даёт пустой перевод', async () => {
    const { fetch } = stub({ status: 503 });
    const said = await libreTranslator({ url: 'http://libre.test:5000', fetch }).translate(['Лифт'], 'en', 'ru');

    assert.deepEqual(said, [undefined]);
  });

  it('пачка переводится по тексту, и порядок сохраняется', async () => {
    const calls: string[] = [];

    const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const { q } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { q: string };

      calls.push(q);

      return Promise.resolve(
        new Response(JSON.stringify({ translatedText: `EN: ${q}` }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const said = await libreTranslator({
      url: 'http://libre.test:5000',
      fetch: fetchStub,
    }).translate(['Первый', 'Второй', 'Третий'], 'en', 'ru');

    assert.deepEqual(said, ['EN: Первый', 'EN: Второй', 'EN: Третий']);
    assert.equal(calls.length, 3);
  });
});

describe('MyMemory', () => {
  it('спрашивает переводом в строке запроса и добавляет почту', async () => {
    const { calls, fetch } = stub({ body: { responseStatus: 200, responseData: { translatedText: 'Lift is broken' } } });

    const said = await myMemoryTranslator({ email: 'uk@example.org', fetch }).translate(['Лифт сломан'], 'en', 'ru');

    assert.deepEqual(said, ['Lift is broken']);

    const url = new URL(calls[0]?.url ?? '');

    assert.equal(url.host, 'api.mymemory.translated.net');
    assert.equal(url.searchParams.get('q'), 'Лифт сломан');
    assert.equal(url.searchParams.get('langpair'), 'ru|en');
    assert.equal(url.searchParams.get('de'), 'uk@example.org');
  });

  it('китайский называется кодом самой службы', async () => {
    const { calls, fetch } = stub({ body: { responseStatus: 200, responseData: { translatedText: '电梯坏了' } } });

    await myMemoryTranslator({ fetch }).translate(['Лифт сломан'], 'zh', 'ru');

    assert.equal(new URL(calls[0]?.url ?? '').searchParams.get('langpair'), 'ru|zh-CN');
  });

  it('исчерпанный дневной предел переводом не считается', async () => {
    const { fetch } = stub({
      body: {
        responseStatus: 200,
        responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' },
      },
    });

    assert.deepEqual(await myMemoryTranslator({ fetch }).translate(['Лифт'], 'en', 'ru'), [undefined]);
  });

  it('свой код ответа службы тоже оставляет текст без перевода', async () => {
    const { fetch } = stub({ body: { responseStatus: 403, responseData: { translatedText: 'нет доступа' } } });

    assert.deepEqual(await myMemoryTranslator({ fetch }).translate(['Лифт'], 'en', 'ru'), [undefined]);
  });
});

describe('выбор службы перевода из окружения', () => {
  it('без TRANSLATE_KIND перевода нет', () => {
    assert.equal(machineTranslatorFromEnv({}), undefined);
    assert.equal(machineTranslatorFromEnv({ TRANSLATE_URL: 'http://libre.test:5000' }), undefined);
  });

  it('libre без адреса не поднимается', () => {
    assert.equal(machineTranslatorFromEnv({ TRANSLATE_KIND: 'libre' }), undefined);
  });

  it('libre с адресом и mymemory без адреса заводятся', () => {
    assert.notEqual(
      machineTranslatorFromEnv({ TRANSLATE_KIND: 'libre', TRANSLATE_URL: 'http://libre.test:5000' }),
      undefined,
    );

    assert.notEqual(machineTranslatorFromEnv({ TRANSLATE_KIND: 'mymemory' }), undefined);
  });

  it('незнакомое имя службы перевода не включает', () => {
    assert.equal(machineTranslatorFromEnv({ TRANSLATE_KIND: 'deepl' }), undefined);
  });
});
