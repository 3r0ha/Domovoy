import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signInitData } from '@maxkit/bridge';
import type { FastifyInstance } from 'fastify';

import { InMemoryRepository } from '@domovoy/app';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'rate-bot-token';
const BUILDING_ID = 'b1';

const initDataFor = (userId: number): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `q-${userId}`,
      user: JSON.stringify({ id: userId, first_name: 'Жилец' }),
    },
    BOT_TOKEN,
  );

interface Harness {
  app: FastifyInstance;
  /** Управляемые часы: тест не ждёт настоящую минуту. */
  advance: (ms: number) => void;
}

const setup = async (rateLimit: Parameters<typeof buildServer>[0]['rateLimit'] = {}): Promise<Harness> => {
  let clock = 1_000_000;

  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 }],
    }),
    defaultBuildingId: BUILDING_ID,
    rateLimit: rateLimit === false ? false : { ...rateLimit, now: () => clock },
  });

  return { app, advance: (ms: number) => (clock += ms) };
};

describe('ограничение частоты запросов', () => {
  it('обычную работу не трогает, а поток отсекает', async () => {
    const { app } = await setup({ requests: { limit: 3, windowMs: 60_000 } });
    const headers = { authorization: 'Bearer someone' };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: '/api/me', headers });

      assert.equal(response.statusCode, 401, `запрос ${attempt + 1} отклонён не той причиной`);
    }

    const blocked = await app.inject({ method: 'GET', url: '/api/me', headers });

    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().error, 'too_many_requests');

    assert.equal(blocked.headers['retry-after'], '60');

    await app.close();
  });

  it('новое окно начинает счёт заново', async () => {
    const { app, advance } = await setup({ requests: { limit: 1, windowMs: 60_000 } });
    const headers = { authorization: 'Bearer someone' };

    await app.inject({ method: 'GET', url: '/api/me', headers });

    assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers })).statusCode, 429);

    advance(60_001);

    assert.notEqual((await app.inject({ method: 'GET', url: '/api/me', headers })).statusCode, 429);

    await app.close();
  });

  it('чужая сессия за соседа не отвечает', async () => {
    const { app } = await setup({ requests: { limit: 1, windowMs: 60_000 } });

    await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer first' } });

    const other = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer second' } });

    assert.notEqual(other.statusCode, 429);

    await app.close();
  });

  it('перебор подписи упирается в предел входа', async () => {
    const { app } = await setup({ requests: { limit: 100, windowMs: 60_000 }, login: { limit: 2, windowMs: 60_000 } });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: { 'x-max-init-data': 'подпись=не сошлась' },
      });

      assert.equal(response.statusCode, 401);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': 'подпись=не сошлась' },
    });

    assert.equal(blocked.statusCode, 429);

    assert.notEqual((await app.inject({ method: 'GET', url: '/api/me' })).statusCode, 429);

    await app.close();
  });

  it('удачные входы предел не расходуют', async () => {
    const { app } = await setup({ requests: { limit: 100, windowMs: 60_000 }, login: { limit: 2, windowMs: 60_000 } });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: { 'x-max-init-data': await initDataFor(1001 + attempt) },
      });

      assert.equal(response.statusCode, 200, `вход ${attempt + 1} должен пройти`);
    }

    await app.close();
  });

  it('выгрузки упираются в свой предел раньше обычного', async () => {
    const { app } = await setup({
      requests: { limit: 100, windowMs: 60_000 },
      heavy: { limit: 2, windowMs: 60_000 },
    });
    const headers = { authorization: 'Bearer someone' };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: '/api/export/readings.csv', headers });

      assert.notEqual(response.statusCode, 429, `выгрузка ${attempt + 1} отклонена преждевременно`);
    }

    const blocked = await app.inject({ method: 'GET', url: '/api/export/readings.csv', headers });

    assert.equal(blocked.statusCode, 429);

    const usual = await app.inject({ method: 'GET', url: '/api/me', headers });

    assert.notEqual(usual.statusCode, 429, 'обычная работа тем же пределом не закрывается');

    await app.close();
  });

  it('проверка живости в предел не упирается', async () => {
    const { app } = await setup({ requests: { limit: 1, windowMs: 60_000 } });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
    }

    await app.close();
  });

  it('ограничение снимается целиком, когда мешает', async () => {
    const { app } = await setup(false);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: '/api/me' });

      assert.notEqual(response.statusCode, 429);
    }

    await app.close();
  });
});
