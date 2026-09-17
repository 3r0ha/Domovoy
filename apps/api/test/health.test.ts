import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryRepository } from '@domovoy/app';

import { buildServer, health } from '../dist/index.js';

const BUILDING_ID = 'b1';

/** Сервер с одной проверкой живости и двойником хранилища. */
const withStorage = async (storage: () => Promise<unknown>, now?: () => number): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });

  await app.register(health, { storage, ...(now ? { now } : { cacheMs: 0 }) });

  return app;
};

describe('проверка живости', () => {
  it('отвечает «ок», пока хранилище отвечает', async () => {
    const app = await withStorage(() => Promise.resolve([]));

    const response = await app.inject({ method: 'GET', url: '/health' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok', storage: 'ok' });

    await app.close();
  });

  it('недоступное хранилище, это 503, а не «ок»', async () => {
    const app = await withStorage(() => Promise.reject(new Error('база недоступна')));

    const response = await app.inject({ method: 'GET', url: '/health' });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: 'degraded', storage: 'unavailable' });

    await app.close();
  });

  it('в базу не ходят на каждый запрос', async () => {
    let probes = 0;
    const app = await withStorage(() => {
      probes += 1;
      return Promise.resolve([]);
    }, () => 1_000_000);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await app.inject({ method: 'GET', url: '/health' });
    }

    assert.equal(probes, 1);

    await app.close();
  });

  it('восстановившееся хранилище снова даёт «ок»', async () => {
    let broken = true;
    const app = await withStorage(() => (broken ? Promise.reject(new Error('нет базы')) : Promise.resolve([])));

    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 503);

    broken = false;

    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);

    await app.close();
  });
});

describe('заголовки безопасности', () => {
  it('ставятся на каждый ответ', async () => {
    const app = await buildServer({
      botToken: 'headers-bot-token',
      repository: new InMemoryRepository({ buildings: [{ id: BUILDING_ID, code: 'Д15' }], apartments: [] }),
      defaultBuildingId: BUILDING_ID,
    });

    for (const url of ['/health', '/api/me']) {
      const response = await app.inject({ method: 'GET', url });

      assert.equal(response.headers['x-content-type-options'], 'nosniff', url);
      assert.equal(response.headers['x-frame-options'], 'DENY', url);
      assert.equal(response.headers['referrer-policy'], 'no-referrer', url);
    }

    await app.close();
  });
});
