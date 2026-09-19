import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { signInitData } from '@maxkit/bridge';
import Fastify from 'fastify';

import {
  MemorySessionTokenStore,
  createMaxAuthHandler,
  createSessionAuth,
  maxAuth,
  maxSession,
  verifyContact,
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

describe('проверка отдельного маршрута', () => {
  it('preHandler пускает запрос с подписью и отклоняет без неё', async () => {
    const app = Fastify();
    const guard = createMaxAuthHandler({ botToken: BOT_TOKEN });

    app.get('/public', async () => ({ ok: true }));
    app.get('/private', { preHandler: guard }, async (request) => ({ userId: request.max.userId }));

    const open = await app.inject({ method: 'GET', url: '/public' });
    assert.equal(open.statusCode, 200, 'соседний маршрут остаётся публичным');

    const denied = await app.inject({ method: 'GET', url: '/private' });
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.json().error, 'init_data_missing');

    const allowed = await app.inject({
      method: 'GET',
      url: '/private',
      headers: { 'x-max-init-data': await makeInitData() },
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().userId, 424_242);

    await app.close();
  });
});

describe('исключения из проверки', () => {
  it('skip пропускает служебные маршруты', async () => {
    const app = Fastify();

    await app.register(async (scope) => {
      await scope.register(maxAuth, {
        botToken: BOT_TOKEN,
        skip: (request) => request.url.startsWith('/health'),
      });
      scope.get('/health', async () => ({ status: 'ok' }));
      scope.get('/requests', async (request) => ({ userId: request.max.userId }));
    });

    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/requests' })).statusCode, 401);

    await app.close();
  });

  it('строку запуска можно взять откуда угодно', async () => {
    const app = Fastify();

    await app.register(async (scope) => {
      await scope.register(maxAuth, {
        botToken: BOT_TOKEN,
        getInitData: (request) => (request.query as { launch?: string }).launch,
      });
      scope.get('/me', async (request) => ({ userId: request.max.userId }));
    });

    const initData = await makeInitData();
    const response = await app.inject({
      method: 'GET',
      url: `/me?launch=${encodeURIComponent(initData)}`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().userId, 424_242);

    await app.close();
  });

  it('продублированный заголовок запуска не проходит', async () => {
    const app = Fastify();

    await app.register(async (scope) => {
      await scope.register(maxAuth, { botToken: BOT_TOKEN });
      scope.get('/me', async (request) => ({ userId: request.max.userId }));
    });

    const initData = await makeInitData();
    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-max-init-data': [initData, initData] },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'init_data_malformed');

    await app.close();
  });

  it('сессионный плагин тоже умеет пропускать маршруты', async () => {
    const auth = createSessionAuth({ botToken: BOT_TOKEN });
    const app = Fastify();

    await app.register(async (scope) => {
      await scope.register(maxSession, { auth, skip: (request) => request.url === '/ping' });
      scope.get('/ping', async () => ({ pong: true }));
      scope.get('/me', async (request) => ({ userId: request.max.userId }));
    });

    assert.equal((await app.inject({ method: 'GET', url: '/ping' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/me' })).statusCode, 401);

    await app.close();
  });
});

describe('проверка телефона из requestContact', () => {
  const phone = '79995554433';
  const authDate = '1756800000';
  const userId = 424_242;

  const sign = (token: string): string => {
    const dataCheckString = [`authDate=${authDate}`, `phone=${phone}`, `userId=${userId}`].sort().join('\n');
    return createHmac('sha256', token).update(dataCheckString).digest('hex');
  };

  it('подтверждает телефон, подписанный токеном бота', () => {
    const hash = sign(BOT_TOKEN);

    assert.equal(verifyContact({ botToken: BOT_TOKEN, phone, authDate, userId, hash }), true);
  });

  it('ведущий плюс в номере не мешает', () => {
    const hash = sign(BOT_TOKEN);

    assert.equal(verifyContact({ botToken: BOT_TOKEN, phone: `+${phone}`, authDate, userId, hash }), true);
  });

  it('чужая подпись не проходит', () => {
    const hash = sign('другой-токен');

    assert.equal(verifyContact({ botToken: BOT_TOKEN, phone, authDate, userId, hash }), false);
  });

  it('подпись другой длины не проходит', () => {
    assert.equal(verifyContact({ botToken: BOT_TOKEN, phone, authDate, userId, hash: 'abcd' }), false);
  });

  it('подпись из не-hex символов отвечает отказом, а не исключением', () => {
    const hash = 'ю'.repeat(64);

    assert.equal(verifyContact({ botToken: BOT_TOKEN, phone, authDate, userId, hash }), false);
  });

  it('подпись нужной длины из не-hex символов тоже не проходит', () => {
    // Столько же символов, сколько в настоящей подписи: длина строк совпадает.
    const hash = 'z'.repeat(64);

    assert.equal(verifyContact({ botToken: BOT_TOKEN, phone, authDate, userId, hash }), false);
  });
});

describe('чистка сессий в памяти', () => {
  it('просроченные записи убираются пачкой', () => {
    let now = 1_000_000;
    const store = new MemorySessionTokenStore(() => now, 3);

    const record = (expiresAt: number) => ({
      userId: 1,
      data: {},
      initData: 'raw',
      issuedAt: now,
      expiresAt,
    });

    store.set('a', record(now + 100));
    store.set('b', record(now + 100));
    now += 500;

    store.set('c', record(now + 1000));
    assert.equal(store.size, 1, 'остались только живые сессии');
  });

  it('чистку можно запустить вручную', () => {
    let now = 1_000_000;
    const store = new MemorySessionTokenStore(() => now);

    store.set('a', { userId: 1, data: {}, initData: 'raw', issuedAt: now, expiresAt: now + 100 });
    now += 500;

    assert.equal(store.sweep(), 1);
    assert.equal(store.size, 0);
  });
});
