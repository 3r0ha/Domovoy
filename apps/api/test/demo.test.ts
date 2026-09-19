import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signInitData } from '@maxkit/bridge';
import type { FastifyInstance } from 'fastify';

import { InMemoryRepository } from '@domovoy/app';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'demo-bot-token';
const BUILDING_ID = 'b1';

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 50 },
];

const initDataFor = (userId: number): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `q-${userId}`,
      user: JSON.stringify({ id: userId, first_name: 'Проверяющий' }),
    },
    BOT_TOKEN,
  );

interface Harness {
  app: FastifyInstance;
  token: string;
}

const setup = async (demo: boolean): Promise<Harness> => {
  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: APARTMENTS,
    }),
    defaultBuildingId: BUILDING_ID,
    ...(demo ? { demo: true } : {}),
  });

  const entered = await app.inject({
    method: 'POST',
    url: '/auth/session',
    headers: { 'x-max-init-data': await initDataFor(700) },
  });

  assert.equal(entered.statusCode, 200, entered.body);

  return { app, token: entered.json<{ token: string }>().token };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

interface RoleLine {
  role: string;
  title: string;
  about: string;
  current: boolean;
}

describe('роли для проверки', () => {
  it('в обычной установке раздела нет', async () => {
    const { app, token } = await setup(false);

    const profile = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });

    assert.equal(profile.json<{ demo: boolean }>().demo, false);

    const listed = await app.inject({ method: 'GET', url: '/api/demo', headers: authed(token) });
    const taken = await app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: authed(token),
      payload: { role: 'manager' },
    });

    assert.equal(listed.statusCode, 403);
    assert.equal(taken.statusCode, 403);

    await app.close();
  });

  it('список ролей отмечает текущую', async () => {
    const { app, token } = await setup(true);

    const profile = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });

    assert.equal(profile.json<{ demo: boolean }>().demo, true);

    const roles = (await app.inject({ method: 'GET', url: '/api/demo', headers: authed(token) })).json<RoleLine[]>();

    assert.deepEqual(
      roles.map((line) => line.role),
      ['resident', 'dispatcher', 'technician', 'manager', 'contractor'],
    );
    assert.deepEqual(
      roles.filter((line) => line.current).map((line) => line.role),
      ['resident'],
    );

    await app.close();
  });

  it('после примерки человек работает в новой роли', async () => {
    const { app, token } = await setup(true);

    const taken = await app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: authed(token),
      payload: { role: 'dispatcher' },
    });

    assert.equal(taken.statusCode, 200, taken.body);
    assert.equal(taken.json<{ role: string }>().role, 'dispatcher');

    const profile = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });

    assert.equal(profile.json<{ role: string }>().role, 'dispatcher');

    // Очередь дома открыта только смене: роль примерена целиком, а не на словах.
    const queue = await app.inject({ method: 'GET', url: '/api/requests?scope=queue', headers: authed(token) });

    assert.equal(queue.statusCode, 200, queue.body);

    await app.close();
  });

  it('жильцу дают квартиру, иначе половина разделов пуста', async () => {
    const { app, token } = await setup(true);

    await app.inject({ method: 'POST', url: '/api/demo', headers: authed(token), payload: { role: 'manager' } });
    const back = await app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: authed(token),
      payload: { role: 'resident' },
    });

    assert.equal(back.statusCode, 200, back.body);

    const profile = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });
    const me = profile.json<{ role: string; apartmentId: string | null }>();

    assert.equal(me.role, 'resident');
    assert.notEqual(me.apartmentId, null);

    await app.close();
  });

  it('жильцу дают свободную квартиру, а не чужую', async () => {
    const repository = new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: APARTMENTS,
      residents: [
        {
          id: 'res-taken',
          maxUserId: 1,
          displayName: 'Мария',
          role: 'resident',
          apartmentId: 'apt-1',
          buildingId: BUILDING_ID,
        },
      ],
    });

    const app = await buildServer({
      botToken: BOT_TOKEN,
      repository,
      defaultBuildingId: BUILDING_ID,
      demo: true,
    });

    const entered = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(701) },
    });
    const token = entered.json<{ token: string }>().token;

    await app.inject({ method: 'POST', url: '/api/demo', headers: authed(token), payload: { role: 'manager' } });
    await app.inject({ method: 'POST', url: '/api/demo', headers: authed(token), payload: { role: 'resident' } });

    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) })).json<{
      apartmentId: string | null;
    }>();

    // Первая по номеру квартира занята настоящей жилицей: её показания и
    // квитанция проверяющему доставаться не должны.
    assert.equal(me.apartmentId, 'apt-2');

    await app.close();
  });

  it('несуществующую роль не примерить', async () => {
    const { app, token } = await setup(true);

    const taken = await app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: authed(token),
      payload: { role: 'president' },
    });

    assert.equal(taken.statusCode, 400);

    await app.close();
  });
});
