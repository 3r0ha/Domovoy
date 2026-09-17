import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { InMemoryRepository } from '@domovoy/app';

import { buildServer } from '../dist/index.js';

const BUILDING_ID = 'b1';

const setup = async (metrics: Parameters<typeof buildServer>[0]['metrics'] = {}): Promise<FastifyInstance> =>
  buildServer({
    botToken: 'metrics-bot-token',
    repository: new InMemoryRepository({ buildings: [{ id: BUILDING_ID, code: 'Д15' }], apartments: [] }),
    defaultBuildingId: BUILDING_ID,
    rateLimit: false,
    metrics,
  });

describe('метрики наружу', () => {
  it('отдаёт состояние службы в формате Prometheus', async () => {
    const app = await setup();

    const response = await app.inject({ method: 'GET', url: '/metrics' });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /text\/plain/);
    assert.match(response.body, /^# HELP domovoy_up /m);
    assert.match(response.body, /^domovoy_up 1$/m);
    assert.match(response.body, /^domovoy_uptime_seconds \d+$/m);
    assert.match(response.body, /^domovoy_heap_used_bytes \d+$/m);

    await app.close();
  });

  it('считает запросы по маршруту и коду ответа', async () => {
    const app = await setup();

    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/api/me' });

    const body = (await app.inject({ method: 'GET', url: '/metrics' })).body;

    assert.match(body, /domovoy_http_requests_total\{method="GET",route="\/health",status="200"\} 2/);
    assert.match(body, /domovoy_http_requests_total\{method="GET",route="\/api\/me",status="401"\} 1/);
    assert.match(body, /domovoy_http_request_duration_seconds_count\{method="GET",route="\/health"\} 2/);

    await app.close();
  });

  it('идентификатор заявки в метку не попадает', async () => {
    const app = await setup();

    await app.inject({ method: 'GET', url: '/api/requests/req-1' });
    await app.inject({ method: 'GET', url: '/api/requests/req-2' });

    const body = (await app.inject({ method: 'GET', url: '/metrics' })).body;

    assert.doesNotMatch(body, /req-1/);
    assert.match(body, /route="\/api\/requests\/:id"/);

    await app.close();
  });

  it('сама страница метрик в счётчики не попадает', async () => {
    const app = await setup();

    await app.inject({ method: 'GET', url: '/metrics' });

    const body = (await app.inject({ method: 'GET', url: '/metrics' })).body;

    assert.doesNotMatch(body, /route="\/metrics"/);

    await app.close();
  });

  it('токен закрывает метрики от посторонних', async () => {
    const app = await setup({ token: 'secret' });

    assert.equal((await app.inject({ method: 'GET', url: '/metrics' })).statusCode, 401);

    const allowed = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer secret' },
    });

    assert.equal(allowed.statusCode, 200);

    await app.close();
  });

  it('метрики можно выключить целиком', async () => {
    const app = await setup(false);

    assert.equal((await app.inject({ method: 'GET', url: '/metrics' })).statusCode, 404);

    await app.close();
  });
});
