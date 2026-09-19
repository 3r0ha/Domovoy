import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signInitData } from '@maxkit/bridge';
import type { FastifyInstance } from 'fastify';

import { InMemoryRepository } from '@domovoy/app';

import { DEFAULT_LIMIT, buildServer } from '../dist/index.js';

const BOT_TOKEN = 'rate-bot-token';
const BUILDING_ID = 'b1';

/** Сколько запросов стоит один открытый раздел: список, счётчики и профиль дома. */
const DEFAULT_SCREEN_REQUESTS = 6;

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

  it('чужой адрес за соседа не отвечает', async () => {
    const { app } = await setup({ requests: { limit: 1, windowMs: 60_000 } });

    await app.inject({ method: 'GET', url: '/api/me', remoteAddress: '10.0.0.1' });

    const same = await app.inject({ method: 'GET', url: '/api/me', remoteAddress: '10.0.0.1' });
    const other = await app.inject({ method: 'GET', url: '/api/me', remoteAddress: '10.0.0.2' });

    assert.equal(same.statusCode, 429, 'тот же адрес считается дальше');
    assert.notEqual(other.statusCode, 429);

    await app.close();
  });

  it('за обратным прокси счёт идёт по адресу человека, а не по адресу прокси', async () => {
    const { app } = await setup({ requests: { limit: 1, windowMs: 60_000 } });

    await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-forwarded-for': '203.0.113.1' } });

    const same = await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-forwarded-for': '203.0.113.1' } });
    const other = await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-forwarded-for': '198.51.100.7' } });

    assert.equal(same.statusCode, 429, 'тот же человек считается дальше');
    assert.notEqual(other.statusCode, 429, 'соседи за тем же прокси счётчик не делят');

    await app.close();
  });

  it('описание API считается вместе с остальными запросами', async () => {
    const { app } = await setup({ requests: { limit: 1, windowMs: 60_000 } });

    assert.equal((await app.inject({ method: 'GET', url: '/openapi.json' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/openapi.json' })).statusCode, 429);

    await app.close();
  });

  it('приём снимка считается дорогим, а выдача нет', async () => {
    const { app } = await setup({ requests: { limit: 100, windowMs: 60_000 }, heavy: { limit: 2, windowMs: 60_000 } });
    const headers = { authorization: 'Bearer someone' };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/files', headers, payload: {} });

      assert.notEqual(response.statusCode, 429, `снимок ${attempt + 1} отклонён преждевременно`);
    }

    const blocked = await app.inject({ method: 'POST', url: '/api/files', headers, payload: {} });

    assert.equal(blocked.statusCode, 429);

    const shown = await app.inject({ method: 'GET', url: '/api/files/id-1', headers });

    assert.notEqual(shown.statusCode, 429, 'снимки на экране идут в обычном темпе');

    await app.close();
  });

  it('смена заголовка авторизации предел не снимает', async () => {
    const { app } = await setup({ requests: { limit: 2, windowMs: 60_000 } });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: `Bearer token-${attempt}` },
      });

      assert.equal(response.statusCode, 401, `запрос ${attempt + 1} отклонён не той причиной`);
    }

    const rotated = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer token-9' } });

    assert.equal(rotated.statusCode, 429, 'счёт идёт от адреса, а не от присланного токена');

    await app.close();
  });

  it('перебор входа не снимается новым токеном в заголовке', async () => {
    const { app } = await setup({ login: { limit: 2, windowMs: 60_000 } });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: { 'x-max-init-data': 'подпись=не сошлась', authorization: `Bearer token-${attempt}` },
      });
    }

    const rotated = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': 'подпись=не сошлась', authorization: 'Bearer token-9' },
    });

    assert.equal(rotated.statusCode, 429);

    await app.close();
  });

  it('статика приложения и лендинг бюджет живых людей не тратят', async () => {
    const { app } = await setup({ requests: { limit: 2, windowMs: 60_000 } });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: '/app/assets/main.js' });

      assert.notEqual(response.statusCode, 429, `файл ${attempt + 1} отклонён пределом`);
    }

    const api = await app.inject({ method: 'GET', url: '/api/me' });

    assert.notEqual(api.statusCode, 429, 'работа в приложении осталась при своём пределе');

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

  it('передача дома считается дорогим маршрутом', async () => {
    const { app } = await setup({ requests: { limit: 100, windowMs: 60_000 }, heavy: { limit: 2, windowMs: 60_000 } });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/buildings/handover' });

      assert.notEqual(response.statusCode, 429, `передача ${attempt + 1} отклонена преждевременно`);
    }

    const blocked = await app.inject({ method: 'POST', url: '/api/buildings/handover' });

    assert.equal(blocked.statusCode, 429, 'повторная рассылка дому упирается в предел');

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

  it('обычный просмотр разделов подряд в предел по умолчанию не упирается', async () => {
    const { app } = await setup();
    const headers = { authorization: 'Bearer someone' };

    // Десять разделов подряд, каждый тянет по несколько запросов.
    for (let attempt = 0; attempt < 10 * DEFAULT_SCREEN_REQUESTS; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: '/api/me', headers });

      assert.notEqual(response.statusCode, 429, `запрос ${attempt + 1} отклонён на обычном просмотре`);
    }

    assert.ok(DEFAULT_LIMIT.limit >= 10 * DEFAULT_SCREEN_REQUESTS, 'предел рассчитан на живого человека');

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
