import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signInitData } from '@maxkit/bridge';
import Fastify from 'fastify';

import {
  InitDataError,
  KeyValueSessionTokenStore,
  MemorySessionTokenStore,
  SessionError,
  createSessionAuth,
  maxSession,
} from '../dist/index.js';

const BOT_TOKEN = 'bot-token-for-tests';

const makeInitData = (overrides: Record<string, string | number> = {}): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: 'q-1',
      user: JSON.stringify({ id: 424_242, first_name: 'Жилец' }),
      ...overrides,
    },
    BOT_TOKEN,
  );

describe('обмен параметров запуска на сессию', () => {
  it('выдаёт токен по корректным параметрам', async () => {
    const auth = createSessionAuth({ botToken: BOT_TOKEN });

    const issued = await auth.issue(await makeInitData());

    assert.ok(issued.token.length > 20, 'токен достаточно длинный');
    assert.equal(issued.session.userId, 424_242);
    assert.ok(issued.expiresAt > Date.now());
  });

  it('не выдаёт токен по подделанным параметрам', async () => {
    const auth = createSessionAuth({ botToken: BOT_TOKEN });
    const tampered = (await makeInitData()).replace('424242', '999999');

    await assert.rejects(auth.issue(tampered), InitDataError);
  });

  it('сессия переживает истечение срока параметров запуска', async () => {
    let now = Date.UTC(2026, 8, 3, 10, 0, 0);
    const auth = createSessionAuth({
      botToken: BOT_TOKEN,
      maxAgeSeconds: 3600,
      sessionTtlMs: 12 * 60 * 60 * 1000,
      now: () => now,
    });

    const issued = await auth.issue(await makeInitData({ auth_date: Math.floor(now / 1000) }));

    now += 2 * 60 * 60 * 1000;

    const session = await auth.verify(issued.token);
    assert.equal(session.userId, 424_242, 'приложение продолжает работать, пользователь никуда не уходил');
  });

  it('отклоняет неизвестный и пустой токен', async () => {
    const auth = createSessionAuth({ botToken: BOT_TOKEN });

    await assert.rejects(auth.verify('чужой-токен'), (error: unknown) => {
      assert.ok(error instanceof SessionError);
      assert.equal(error.code, 'session_invalid');
      return true;
    });

    await assert.rejects(auth.verify(null), (error: unknown) => {
      assert.ok(error instanceof SessionError);
      assert.equal(error.code, 'session_missing');
      return true;
    });
  });

  it('отклоняет истёкшую сессию и убирает её из хранилища', async () => {
    let now = 1_000_000;
    const store = new MemorySessionTokenStore(() => now);
    const auth = createSessionAuth({ botToken: BOT_TOKEN, store, sessionTtlMs: 1000, now: () => now });

    const issued = await auth.issue(await makeInitData({ auth_date: Math.floor(now / 1000) }));
    now += 2000;

    await assert.rejects(auth.verify(issued.token), (error: unknown) => {
      assert.ok(error instanceof SessionError);
      assert.equal(error.code, 'session_expired');
      return true;
    });

    assert.equal(store.size, 0);
  });

  it('обновление выдаёт новый токен и гасит прежний', async () => {
    const auth = createSessionAuth({ botToken: BOT_TOKEN });
    const issued = await auth.issue(await makeInitData());

    const refreshed = await auth.refresh(issued.token);

    assert.notEqual(refreshed.token, issued.token);
    assert.equal(refreshed.session.userId, 424_242);
    await assert.rejects(auth.verify(issued.token), SessionError);
  });

  it('отзыв прекращает сессию', async () => {
    const auth = createSessionAuth({ botToken: BOT_TOKEN });
    const issued = await auth.issue(await makeInitData());

    await auth.revoke(issued.token);

    await assert.rejects(auth.verify(issued.token), SessionError);
  });
});

describe('плагин maxSession для Fastify', () => {
  const buildApp = async () => {
    const auth = createSessionAuth({ botToken: BOT_TOKEN });
    const app = Fastify();

    app.post('/auth/session', async (request) => {
      const header = request.headers['x-max-init-data'];
      return auth.issue(Array.isArray(header) ? header[0] : header);
    });

    await app.register(async (scope) => {
      await scope.register(maxSession, { auth });
      scope.get('/me', async (request) => ({ userId: request.max.userId, issuedAt: request.maxSession.issuedAt }));
    });

    return app;
  };

  it('пускает запрос с выданным токеном', async () => {
    const app = await buildApp();

    const issued = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await makeInitData() },
    });
    const { token } = issued.json();

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().userId, 424_242);
    await app.close();
  });

  it('отклоняет запрос без токена и с чужим токеном', async () => {
    const app = await buildApp();

    const withoutToken = await app.inject({ method: 'GET', url: '/me' });
    assert.equal(withoutToken.statusCode, 401);
    assert.equal(withoutToken.json().error, 'session_missing');

    const alien = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer чужой' },
    });
    assert.equal(alien.statusCode, 401);
    assert.equal(alien.json().error, 'session_invalid');

    await app.close();
  });

  it('не принимает токен без схемы Bearer', async () => {
    const app = await buildApp();

    const issued = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await makeInitData() },
    });
    const { token } = issued.json();

    const response = await app.inject({ method: 'GET', url: '/me', headers: { authorization: token } });

    assert.equal(response.statusCode, 401);
    await app.close();
  });

  it('маршрут выдачи сессии остаётся публичным', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await makeInitData() },
    });

    assert.equal(response.statusCode, 200);
    await app.close();
  });
});

describe('сессии в общем хранилище', () => {
  /** Хранилище ключ-значение той же формы, что у Redis-обёртки. */
  const memoryKv = () => {
    const entries = new Map<string, { value: string; ttlMs?: number }>();

    return {
      entries,
      get: (key: string): Promise<string | null> => Promise.resolve(entries.get(key)?.value ?? null),
      set: (key: string, value: string, ttlMs?: number): Promise<void> => {
        entries.set(key, ttlMs === undefined ? { value } : { value, ttlMs });
        return Promise.resolve();
      },
      delete: (key: string): Promise<void> => {
        entries.delete(key);
        return Promise.resolve();
      },
    };
  };

  it('токен, выданный одним экземпляром, работает на другом', async () => {
    const kv = memoryKv();

    const first = createSessionAuth({ botToken: BOT_TOKEN, store: new KeyValueSessionTokenStore(kv) });
    const second = createSessionAuth({ botToken: BOT_TOKEN, store: new KeyValueSessionTokenStore(kv) });

    const issued = await first.issue(await makeInitData());
    const seen = await second.verify(issued.token);

    assert.equal(seen.userId, 424_242);
  });

  it('запись живёт дольше собственного срока, чтобы истёкшая сессия отличалась от неизвестной', async () => {
    const kv = memoryKv();
    const auth = createSessionAuth({
      botToken: BOT_TOKEN,
      store: new KeyValueSessionTokenStore(kv),
      sessionTtlMs: 60_000,
    });

    const issued = await auth.issue(await makeInitData());
    const [stored] = [...kv.entries.values()];

    assert.ok(stored?.ttlMs !== undefined && stored.ttlMs > 60_000, `срок хранения ${String(stored?.ttlMs)}`);
    assert.ok(issued.token.length > 20);
  });

  it('выход убирает запись из общего хранилища', async () => {
    const kv = memoryKv();
    const auth = createSessionAuth({ botToken: BOT_TOKEN, store: new KeyValueSessionTokenStore(kv) });

    const issued = await auth.issue(await makeInitData());
    await auth.revoke(issued.token);

    assert.equal(kv.entries.size, 0);
    await assert.rejects(auth.verify(issued.token), (error: SessionError) => error.code === 'session_invalid');
  });

  it('испорченная запись читается как отсутствие сессии, а не роняет приложение', async () => {
    const kv = memoryKv();
    const store = new KeyValueSessionTokenStore(kv);

    await kv.set('session:broken', '{это не JSON');

    assert.equal(await store.get('broken'), undefined);
  });
});
