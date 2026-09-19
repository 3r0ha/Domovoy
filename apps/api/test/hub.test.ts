import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createMockHub,
  type Device,
  type Notification,
  type Resident,
} from '@domovoy/app';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'hub-bot-token';
const BUILDING_ID = 'b1';
const SECRET = 'очень-секретно';

const DEVICES: Device[] = [
  { id: 'intercom-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 },
  { id: 'leak-1-2', buildingId: BUILDING_ID, kind: 'leak', title: 'Датчик протечки, стояк 2', entrance: 1, riser: 2 },
];

const PEOPLE: Resident[] = [
  { id: 'staff-1', maxUserId: 2001, displayName: 'Ольга', role: 'dispatcher', buildingId: BUILDING_ID },
  { id: 'res-1', maxUserId: 1001, displayName: 'Иван', role: 'resident', apartmentId: 'apt-1', buildingId: BUILDING_ID },
];

const setup = async ({ secret }: { secret?: string | null } = {}) => {
  const hubSecret = secret === undefined ? SECRET : secret;

  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15' }],
    apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 2 }],
    residents: PEOPLE,
  });

  const hub = createMockHub({ devices: DEVICES, now: () => new Date(), createCode: () => '123456' });
  const sent: Notification[] = [];
  let counter = 0;

  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository,
    defaultBuildingId: BUILDING_ID,
    createId: () => `id-${++counter}`,
    hub,
    ...(hubSecret ? { hubSecret } : {}),
    notifier: {
      async send(notification) {
        sent.push(notification);
      },
    },
  });

  return { app, hub, repository, sent };
};

const signed = { 'x-hub-secret': SECRET };

describe('события от домофонии', () => {
  it('срабатывание датчика заводит заявку', async () => {
    const { app, repository } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/api/hub/alarm',
      headers: signed,
      payload: { buildingId: BUILDING_ID, deviceId: 'leak-1-2' },
    });

    assert.equal(response.statusCode, 202);

    const [request] = await repository.listRequests({ buildingId: BUILDING_ID });

    assert.equal(request?.priority, 'emergency');
    assert.match(request?.title ?? '', /протечк/i);

    await app.close();
  });

  it('без секрета оборудование не пускают', async () => {
    const { app, repository } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/api/hub/alarm',
      payload: { buildingId: BUILDING_ID, deviceId: 'leak-1-2' },
    });

    assert.equal(response.statusCode, 401);
    assert.equal((await repository.listRequests({ buildingId: BUILDING_ID })).length, 0, 'заявки не появилось');

    await app.close();
  });

  it('секрет сверяется раньше разбора тела', async () => {
    const { app } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/api/hub/alarm',
      payload: { лишнее: true },
    });

    assert.equal(response.statusCode, 401, 'без секрета тело не разбирается');
    assert.equal(response.json().error, 'unauthorized');

    await app.close();
  });

  it('похожий секрет не подходит: ни короче, ни длиннее, ни с другим знаком', async () => {
    const { app, repository } = await setup();

    for (const secret of [SECRET.slice(0, -1), `${SECRET}!`, `${SECRET.slice(0, -1)}а`]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/hub/alarm',
        headers: { 'x-hub-secret': secret },
        payload: { buildingId: BUILDING_ID, deviceId: 'leak-1-2' },
      });

      assert.equal(response.statusCode, 401, secret);
    }

    assert.equal((await repository.listRequests({ buildingId: BUILDING_ID })).length, 0);

    await app.close();
  });

  it('без настроенного секрета маршрутов нет вовсе', async () => {
    const { app } = await setup({ secret: null });

    const response = await app.inject({
      method: 'POST',
      url: '/api/hub/alarm',
      headers: signed,
      payload: { buildingId: BUILDING_ID, deviceId: 'leak-1-2' },
    });

    assert.equal(response.statusCode, 404);

    await app.close();
  });

  it('вход по гостевому коду доходит до того, кто его выдал', async () => {
    const { app, hub, sent } = await setup();

    const issued = await hub.issueGuestCode('intercom-1', 15, 'res-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/hub/guest-entry',
      headers: signed,
      payload: { code: issued.code },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(sent.filter((item) => item.maxUserId === 1001).length, 1);

    await app.close();
  });

  it('чужой код дверь не открывает', async () => {
    const { app, sent } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/api/hub/guest-entry',
      headers: signed,
      payload: { code: '000000' },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(sent.length, 0);

    await app.close();
  });
});
