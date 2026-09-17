import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ApiError,
  DomovoyApi,
  actionTitle,
  formatDeadline,
  formatPublished,
  formatSince,
  statusTitle,
} from '../dist-test/api.js';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const createFetchStub = (responses: { status: number; body: unknown }[]) => {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });

    const next = responses[Math.min(index, responses.length - 1)] ?? { status: 200, body: {} };
    index += 1;

    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { fetchStub, calls };
};

const api = (responses: { status: number; body: unknown }[]) => {
  const { fetchStub, calls } = createFetchStub(responses);
  return { client: new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub }), calls };
};

describe('вход', () => {
  it('обменивает параметры запуска на токен и дальше ходит с ним', async () => {
    const { client, calls } = api([
      { status: 200, body: { token: 'tok', expiresAt: 1, displayName: 'Мария' } },
      { status: 200, body: { id: 'r1', displayName: 'Мария', role: 'resident', apartmentId: null } },
    ]);

    await client.login('user=...&hash=...');
    await client.me();

    assert.equal(calls[0]?.headers['x-max-init-data'], 'user=...&hash=...');
    assert.equal(calls[0]?.headers['authorization'], undefined, 'при входе токена ещё нет');
    assert.equal(calls[1]?.headers['authorization'], 'Bearer tok');
  });

  it('два входа подряд обменивают строку запуска один раз', async () => {
    const { client, calls } = api([{ status: 200, body: { token: 'tok', expiresAt: 1, displayName: 'Мария' } }]);

    const [first, second] = await Promise.all([client.login('user=...'), client.login('user=...')]);

    assert.equal(calls.length, 1);
    assert.equal(first.token, second.token);
  });

  it('готовый токен можно подставить без повторного входа', async () => {
    const { client, calls } = api([{ status: 200, body: { id: 'r1', displayName: 'М', role: 'resident', apartmentId: null } }]);

    client.useToken('saved-token');
    await client.me();

    assert.equal(calls[0]?.headers['authorization'], 'Bearer saved-token');
  });
});

describe('ошибки', () => {
  it('разбирает ответ сервера в ApiError', async () => {
    const { client } = api([{ status: 403, body: { error: 'role_not_allowed', message: 'Роль не может' } }]);

    await assert.rejects(client.transition('req-1', 'accepted'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'role_not_allowed');
      assert.equal(error.status, 403);
      assert.equal(error.isUnauthorized, false);
      return true;
    });
  });

  it('истёкшая сессия распознаётся отдельно', async () => {
    const { client } = api([{ status: 401, body: { error: 'session_expired', message: 'Сессия истекла' } }]);

    await assert.rejects(client.me(), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.isUnauthorized, true);
      return true;
    });
  });
});

describe('запросы', () => {
  it('создание заявки уходит с кодом объекта', async () => {
    const { client, calls } = api([{ status: 201, body: { id: 'req-1' } }]);

    await client.createRequest({ description: 'Течёт кран', startParam: 'apt_apt-1' });

    assert.equal(calls[0]?.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { description: 'Течёт кран', startParam: 'apt_apt-1' });
  });

  it('очередь запрашивается отдельной областью', async () => {
    const { client, calls } = api([{ status: 200, body: [] }]);

    await client.listRequests('queue');

    assert.match(calls[0]?.url ?? '', /scope=queue$/);
  });

  it('одновременные чтения одного адреса делят один запрос', async () => {
    const { client, calls } = api([{ status: 200, body: [{ id: 'req-1' }] }]);

    const [first, second] = await Promise.all([client.listRequests('mine'), client.listRequests('mine')]);

    assert.equal(calls.length, 1, 'круг по сети оплачивается один раз');
    assert.deepEqual(first, second);
  });

  it('следующее чтение идёт на сервер заново', async () => {
    const { client, calls } = api([{ status: 200, body: [] }]);

    await client.listRequests('mine');
    await client.listRequests('mine');

    assert.equal(calls.length, 2);
  });

  it('неудачное чтение не залипает', async () => {
    const { client, calls } = api([
      { status: 500, body: { error: 'boom', message: 'Сервер прилёг' } },
      { status: 200, body: [] },
    ]);

    await assert.rejects(client.listRequests('mine'), ApiError);
    await client.listRequests('mine');

    assert.equal(calls.length, 2, 'после ошибки повтор уходит на сервер');
  });

  it('запись не делится ни с чем: два нажатия, два действия', async () => {
    const { client, calls } = api([{ status: 200, body: {} }]);

    await Promise.all([client.comment('req-1', 'Раз'), client.comment('req-1', 'Два')]);

    assert.equal(calls.length, 2);
  });

  it('идентификаторы экранируются в пути', async () => {
    const { client, calls } = api([{ status: 200, body: {} }]);

    await client.getRequest('a/b?c');

    assert.equal(calls[0]?.url, 'http://api.test/api/requests/a%2Fb%3Fc');
  });

  it('лента объявлений запрашивается без параметров', async () => {
    const { client, calls } = api([{ status: 200, body: [] }]);

    await client.listAnnouncements();

    assert.equal(calls[0]?.url, 'http://api.test/api/announcements');
    assert.equal(calls[0]?.method, 'GET');
  });

  it('переход с причиной передаёт комментарий', async () => {
    const { client, calls } = api([{ status: 200, body: {} }]);

    await client.transition('req-1', 'rejected', { comment: 'Не относится к общему имуществу' });

    assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), {
      to: 'rejected',
      comment: 'Не относится к общему имуществу',
    });
  });

  it('назначение исполнителя уходит вместе с переходом', async () => {
    const { client, calls } = api([{ status: 200, body: {} }]);

    await client.transition('req-1', 'in_progress', { assigneeId: 'tech-1' });

    assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { to: 'in_progress', assigneeId: 'tech-1' });
  });

  it('пустые поля в запрос не попадают', async () => {
    const { client, calls } = api([{ status: 200, body: {} }]);

    await client.transition('req-1', 'accepted');

    assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { to: 'accepted' });
  });
});

describe('человеческие подписи', () => {
  it('статусы и действия переводятся', () => {
    assert.equal(statusTitle('in_progress'), 'Выполняется');
    assert.equal(statusTitle('неизвестно'), 'неизвестно');
    assert.equal(actionTitle('rejected'), 'Отклонить');
  });

  it('срок показывается остатком времени, а не датой', () => {
    const now = new Date('2026-09-03T10:00:00Z');

    assert.equal(formatDeadline('2026-09-03T10:30:00Z', now), 'осталось 30 мин');
    assert.equal(formatDeadline('2026-09-03T13:00:00Z', now), 'осталось 3 ч');
    assert.equal(formatDeadline('2026-09-05T10:00:00Z', now), 'осталось 2 дня');
    assert.equal(formatDeadline('2026-09-04T10:00:00Z', now), 'остался 1 день');
    assert.equal(formatDeadline('2026-09-08T10:00:00Z', now), 'осталось 5 дней');
    assert.equal(formatDeadline('2026-09-24T10:00:00Z', now), 'остался 21 день');
    assert.equal(formatDeadline('2026-09-14T10:00:00Z', now), 'осталось 11 дней');
    assert.equal(formatDeadline('2026-09-03T10:21:00Z', now), 'осталась 21 мин');
  });

  it('прошедшее время называется теми же словами, что и оставшееся', () => {
    const now = new Date('2026-09-03T10:00:00Z');

    assert.equal(formatSince('2026-09-03T09:30:00Z', now), '30 мин');
    assert.equal(formatSince('2026-09-02T21:00:00Z', now), '13 ч');
    assert.equal(formatSince('2026-09-03T12:00:00Z', now), '0 мин');
  });

  it('дата публикации показывается датой, а не остатком времени', () => {
    assert.match(formatPublished('2026-09-03T10:30:00Z'), /3 сентября/);
  });

  it('просрочка называется просрочкой', () => {
    const now = new Date('2026-09-03T10:00:00Z');

    assert.equal(formatDeadline('2026-09-03T09:30:00Z', now), 'просрочено на 30 мин');
    assert.equal(formatDeadline('2026-09-03T07:00:00Z', now), 'просрочено на 3 ч');
  });
});

/** Хранилище в памяти: в тестах браузерного нет, а поведение то же. */
const testCache = () => {
  const store = new Map<string, string>();

  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => void store.set(key, value),
    clear: () => store.clear(),
    size: () => store.size,
  };
};

describe('пропавшая связь', () => {
  it('показывает последний ответ вместо пустоты', async () => {
    const cache = testCache();
    let alive = true;

    const client = new DomovoyApi({
      baseUrl: 'http://api.test',
      cache,
      onOffline: (value) => (offline = value),
      fetch: () =>
        alive
          ? Promise.resolve(
              new Response(JSON.stringify([{ id: 'req-1' }]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            )
          : Promise.reject(new TypeError('Failed to fetch')),
    });

    let offline = false;

    assert.deepEqual(await client.listRequests(), [{ id: 'req-1' }]);
    assert.equal(offline, false);

    alive = false;

    assert.deepEqual(await client.listRequests(), [{ id: 'req-1' }], 'экран остался');
    assert.equal(offline, true, 'но приложение знает, что он несвежий');
  });

  it('отказ сервера сохранённым экраном не подменяется', async () => {
    const cache = testCache();
    let allowed = true;

    const client = new DomovoyApi({
      baseUrl: 'http://api.test',
      cache,
      fetch: () =>
        Promise.resolve(
          allowed
            ? new Response(JSON.stringify([{ id: 'req-1' }]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            : new Response(JSON.stringify({ error: 'forbidden', message: 'Только сотрудникам' }), {
                status: 403,
                headers: { 'content-type': 'application/json' },
              }),
        ),
    });

    await client.listRequests();
    allowed = false;

    await assert.rejects(client.listRequests(), ApiError);
  });

  it('смена человека стирает сохранённое', async () => {
    const cache = testCache();
    const client = new DomovoyApi({
      baseUrl: 'http://api.test',
      cache,
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }),
        ),
    });

    client.useToken('первый');
    await client.listRequests();

    assert.ok(cache.size() > 0);

    client.useToken('второй');

    assert.equal(cache.size(), 0, 'чужие экраны новому человеку не показывают');
  });
});

const { isSectionParam, screenFromStartParam } = await import('../dist-test/navigation.js');

describe('ссылка из чата', () => {
  it('открывает приложение сразу на разделе', () => {
    assert.equal(screenFromStartParam('go-queue'), 'queue');
    assert.equal(screenFromStartParam('go-house-meters'), 'house-meters');
  });

  it('код объекта разделом не считается', () => {
    assert.equal(screenFromStartParam('ent_dom15_1'), undefined);
    assert.equal(isSectionParam('ent_dom15_1'), false);
  });

  it('незнакомый раздел открывает приложение с начала, а не паспорт объекта', () => {
    assert.equal(screenFromStartParam('go-neverwas'), undefined);
    assert.equal(isSectionParam('go-neverwas'), true, 'паспорт по такой ссылке не ищется');
  });
});
