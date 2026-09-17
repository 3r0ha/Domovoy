import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signInitData } from '@maxkit/bridge';
import type { FastifyInstance } from 'fastify';

import { InMemoryRepository, type Resident } from '@domovoy/app';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'visits-bot-token';
const BUILDING_ID = 'b1';
const ZONE = 'Asia/Yekaterinburg';

const RESIDENT: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const OTHER: Resident = {
  id: 'res-2',
  maxUserId: 1002,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

const MANAGER: Resident = {
  id: 'man-1',
  maxUserId: 2003,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

const initDataFor = (userId: number, name: string): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `q-${userId}`,
      user: JSON.stringify({ id: userId, first_name: name }),
    },
    BOT_TOKEN,
  );

interface Slot {
  at: string;
  day: string;
  clock: string;
}

const setup = async (): Promise<{ app: FastifyInstance; login: (userId: number, name: string) => Promise<string> }> => {
  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', timeZone: ZONE }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
      ],
      residents: [RESIDENT, OTHER, MANAGER],
    }),
    defaultBuildingId: BUILDING_ID,
  });

  const login = async (userId: number, name: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(userId, name) },
    });

    assert.equal(response.statusCode, 200, response.body);

    return response.json<{ token: string }>().token;
  };

  return { app, login };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

describe('запись на приём по HTTP', () => {
  it('без приёмных окон свободных часов нет', async () => {
    const { app, login } = await setup();

    const reception = await app.inject({
      method: 'GET',
      url: '/api/reception',
      headers: authed(await login(1001, 'Мария')),
    });

    assert.equal(reception.statusCode, 200);
    assert.deepEqual(reception.json<{ slots: Slot[] }>().slots, []);

    await app.close();
  });

  it('управляющий открывает приём, жилец записывается и отменяет', async () => {
    const { app, login } = await setup();
    const manager = await login(2003, 'Нина');
    const resident = await login(1001, 'Мария');

    const card = await app.inject({
      method: 'POST',
      url: '/api/buildings/card',
      headers: authed(manager),
      payload: {
        reception: [{ weekday: 2, from: '15:00', to: '17:00' }],
        visitMinutes: 30,
        service: { office: 'ул. Ленина, 15, офис 1' },
      },
    });

    assert.equal(card.statusCode, 200, card.body);
    assert.equal(card.json<{ reception: unknown[] }>().reception.length, 1);

    const reception = (
      await app.inject({ method: 'GET', url: '/api/reception', headers: authed(resident) })
    ).json<{ slots: Slot[]; hours: string; office?: string; minutes: number }>();

    assert.equal(reception.hours, 'вторник 15:00-17:00');
    assert.equal(reception.office, 'ул. Ленина, 15, офис 1');
    assert.equal(reception.minutes, 30);
    assert.ok(reception.slots.length > 0, 'свободных часов нет');

    const booked = await app.inject({
      method: 'POST',
      url: '/api/visits',
      headers: authed(resident),
      payload: { at: reception.slots[0]!.at, topic: 'Перерасчёт за горячую воду' },
    });

    assert.equal(booked.statusCode, 201, booked.body);

    const visit = booked.json<{ id: string; status: string; day: string; clock: string }>();

    assert.equal(visit.status, 'booked');
    assert.equal(visit.clock, '15:00');

    const taken = await app.inject({
      method: 'POST',
      url: '/api/visits',
      headers: authed(await login(1002, 'Иван')),
      payload: { at: reception.slots[0]!.at, topic: 'Тот же час' },
    });

    assert.equal(taken.statusCode, 409, taken.body);

    const mine = (
      await app.inject({ method: 'GET', url: '/api/visits', headers: authed(resident) })
    ).json<{ id: string }[]>();

    assert.deepEqual(
      mine.map((item) => item.id),
      [visit.id],
    );

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/visits/${visit.id}/cancel`,
      headers: authed(resident),
    });

    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json<{ status: string }>().status, 'cancelled');

    const after = (
      await app.inject({ method: 'GET', url: '/api/reception', headers: authed(resident) })
    ).json<{ slots: Slot[]; mine?: unknown }>();

    assert.equal(after.mine, undefined);
    assert.equal(after.slots.length, reception.slots.length);

    await app.close();
  });

  it('чужую запись жилец не отменит', async () => {
    const { app, login } = await setup();
    const manager = await login(2003, 'Нина');
    const resident = await login(1001, 'Мария');

    await app.inject({
      method: 'POST',
      url: '/api/buildings/card',
      headers: authed(manager),
      payload: { reception: [{ weekday: 2, from: '15:00', to: '17:00' }] },
    });

    const slots = (
      await app.inject({ method: 'GET', url: '/api/reception', headers: authed(resident) })
    ).json<{ slots: Slot[] }>().slots;

    const visit = await app.inject({
      method: 'POST',
      url: '/api/visits',
      headers: authed(resident),
      payload: { at: slots[0]!.at, topic: 'Перерасчёт' },
    });

    const foreign = await app.inject({
      method: 'POST',
      url: `/api/visits/${visit.json<{ id: string }>().id}/cancel`,
      headers: authed(await login(1002, 'Иван')),
    });

    assert.equal(foreign.statusCode, 404);

    await app.close();
  });

  it('окно с ошибкой карточка не принимает', async () => {
    const { app, login } = await setup();

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/buildings/card',
      headers: authed(await login(2003, 'Нина')),
      payload: { reception: [{ weekday: 2, from: '19:00', to: '15:00' }] },
    });

    assert.equal(wrong.statusCode, 400, wrong.body);
    assert.equal(wrong.json<{ error: string }>().error, 'reception_invalid');

    await app.close();
  });
});

describe('выгрузка файлом в переписку', () => {
  it('жильцу реестр заявок не отдают', async () => {
    const { app, login } = await setup();

    const refused = await app.inject({
      method: 'POST',
      url: '/api/report/requests/send',
      headers: authed(await login(1001, 'Мария')),
    });

    assert.equal(refused.statusCode, 403, refused.body);

    await app.close();
  });

  it('без канала отправки смена получает понятный отказ', async () => {
    const { app, login } = await setup();

    const answer = await app.inject({
      method: 'POST',
      url: '/api/report/requests/send',
      headers: authed(await login(2003, 'Нина')),
    });

    // Канал доставки файлов подключает бот: без него это отказ, а не молчание.
    assert.equal(answer.statusCode, 503, answer.body);
    assert.match(answer.json<{ message: string }>().message, /Отправка файлов не настроена/);

    await app.close();
  });
});
