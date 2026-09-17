import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { InMemoryRepository } from '@domovoy/app';

import { buildServer } from '../dist/index.js';

const BUILDING_ID = 'b1';

/** Каталог со статикой: описание API не должно про неё знать. */
const WEB_DIR = await mkdtemp(join(tmpdir(), 'domovoy-openapi-'));

await writeFile(join(WEB_DIR, 'index.html'), '<!doctype html><title>Домовой</title>');

const setup = async (): Promise<FastifyInstance> =>
  buildServer({
    botToken: 'openapi-bot-token',
    repository: new InMemoryRepository({ buildings: [{ id: BUILDING_ID, code: 'Д15' }], apartments: [] }),
    defaultBuildingId: BUILDING_ID,
    rateLimit: false,
  });

interface Operation {
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: { content: Record<string, { schema: { required?: string[] } }> };
  responses: Record<string, unknown>;
  security?: unknown[];
}

const document = async (app: FastifyInstance): Promise<{ paths: Record<string, Record<string, Operation>> }> =>
  (await app.inject({ method: 'GET', url: '/openapi.json' })).json();

describe('описание API', () => {
  it('отдаётся и называет продукт', async () => {
    const app = await setup();

    const response = await app.inject({ method: 'GET', url: '/openapi.json' });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().openapi, '3.1.0');
    assert.equal(response.json().info.title, 'Домовой');

    await app.close();
  });

  it('перечисляет маршруты продукта', async () => {
    const app = await setup();
    const { paths } = await document(app);

    for (const path of ['/auth/session', '/api/requests', '/api/meters', '/api/polls', '/api/report', '/health']) {
      assert.ok(paths[path], `нет описания ${path}`);
    }

    await app.close();
  });

  it('идентификатор в адресе описан параметром', async () => {
    const app = await setup();
    const { paths } = await document(app);

    const transition = paths['/api/requests/{id}/transition']?.['post'];

    assert.ok(transition, 'нет описания перехода');
    assert.deepEqual(
      transition.parameters?.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name),
      ['id'],
    );

    await app.close();
  });

  it('строка запроса описана вместе с телом', async () => {
    const app = await setup();
    const { paths } = await document(app);

    const list = paths['/api/requests']?.['get'];
    const create = paths['/api/requests']?.['post'];

    assert.deepEqual(
      list?.parameters?.map((parameter) => parameter.name).sort(),
      ['before', 'buildingId', 'limit', 'scope'],
    );
    assert.deepEqual(create?.requestBody?.content['application/json']?.schema.required, ['description']);

    await app.close();
  });

  it('видно, где нужна сессия, а где нет', async () => {
    const app = await setup();
    const { paths } = await document(app);

    assert.deepEqual(paths['/auth/session']?.['post']?.security, []);
    assert.deepEqual(paths['/health']?.['get']?.security, []);
    assert.deepEqual(paths['/api/meters']?.['get']?.security, [{ session: [] }]);

    await app.close();
  });

  it('коды отказов описаны, а не только успех', async () => {
    const app = await setup();
    const { paths } = await document(app);

    const responses = paths['/api/requests']?.['get']?.responses ?? {};

    assert.ok(responses['200'], 'нет успешного ответа');
    assert.ok(responses['401'], 'нет отказа без сессии');
    assert.ok(responses['429'], 'нет превышения частоты');

    await app.close();
  });

  it('само описание в список маршрутов не попадает', async () => {
    const app = await setup();
    const { paths } = await document(app);

    assert.equal(paths['/openapi.json'], undefined);

    await app.close();
  });

  it('раздача лендинга и приложения в описание API не попадает', async () => {
    const app = await buildServer({
      botToken: 'openapi-bot-token',
      repository: new InMemoryRepository({ buildings: [{ id: BUILDING_ID, code: 'Д15' }], apartments: [] }),
      defaultBuildingId: BUILDING_ID,
      web: { landing: WEB_DIR, miniapp: WEB_DIR },
    });

    const { paths } = await document(app);

    assert.deepEqual(
      Object.keys(paths).filter((path) => path.includes('*')),
      [],
    );
    assert.ok(paths['/api/requests'], 'маршруты API остались на месте');

    await app.close();
  });

  it('описание можно выключить', async () => {
    const app = await buildServer({
      botToken: 'openapi-bot-token',
      repository: new InMemoryRepository({ buildings: [{ id: BUILDING_ID, code: 'Д15' }], apartments: [] }),
      defaultBuildingId: BUILDING_ID,
      openApi: false,
    });

    assert.equal((await app.inject({ method: 'GET', url: '/openapi.json' })).statusCode, 404);

    await app.close();
  });
});
