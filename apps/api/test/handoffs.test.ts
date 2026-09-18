import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, createCollectingNotifier, createMockHandoffs, type Resident } from '@domovoy/app';
import { signInitData } from '@maxkit/bridge';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'handoff-bot-token';
const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const manager: Resident = { ...dispatcher, id: 'mgr-1', maxUserId: 7007, displayName: 'Нина', role: 'manager' };

const initDataFor = (userId: number): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `q-${userId}`,
      user: JSON.stringify({ id: userId }),
    },
    BOT_TOKEN,
  );

const setup = async (options: { withGateway?: boolean } = {}) => {
  let counter = 0;

  const repository = new InMemoryRepository({
    buildings: [
      {
        id: BUILDING_ID,
        code: 'Д15',
        address: 'ул. Ленина, 15',
        partners: [{ kind: 'resource', title: 'Водоканал', categories: ['plumbing'], channel: 'email' }],
      },
    ],
    apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
    residents: [maria, dispatcher, manager],
  });

  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository,
    defaultBuildingId: BUILDING_ID,
    createId: () => `id-${++counter}`,
    now: () => new Date('2026-09-22T10:00:00Z'),
    notifier: createCollectingNotifier(),
    ...(options.withGateway ? { handoffs: createMockHandoffs({ channel: 'gis_zhkh' }) } : {}),
  });

  const login = async (userId: number): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(userId) },
    });

    return response.json<{ token: string }>().token;
  };

  return { app, login };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

const leak = async (app: Awaited<ReturnType<typeof setup>>['app'], token: string): Promise<string> => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/requests',
    headers: authed(token),
    payload: { description: 'Нет холодной воды в стояке со вчерашнего дня' },
  });

  return created.json().request.id as string;
};

describe('передача обращения по HTTP', () => {
  it('жилец видит, кто отвечает, и на каком основании', async () => {
    const { app, login } = await setup();
    const token = await login(1001);
    const id = await leak(app, token);

    const response = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}/responsibility`,
      headers: authed(token),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().kind, 'management');
    // Жильцу идёт короткая строка: номер статьи ему ничего не решает.
    assert.match(response.json().basis, /общее имущество дома/i);
    assert.deepEqual(response.json().targets, [], 'жильцу список адресатов не нужен');

    await app.close();
  });

  it('смена передаёт обращение, жилец видит срок ответа и номер', async () => {
    const { app, login } = await setup({ withGateway: true });
    const token = await login(1001);
    const id = await leak(app, token);
    const staff = await login(5005);

    const passed = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/handoff`,
      headers: authed(staff),
      payload: { to: 'resource' },
    });

    assert.equal(passed.statusCode, 200);
    assert.equal(passed.json().organization, 'Водоканал');
    assert.equal(passed.json().status, 'accepted');
    assert.equal(passed.json().dueAt, '2026-09-22T12:00:00.000Z');
    assert.match(passed.json().externalId, /^РСО-/);

    const seen = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}/responsibility`,
      headers: authed(token),
    });

    assert.equal(seen.json().handoffs.length, 1);
    assert.equal(seen.json().handoffs[0].statusTitle, 'принято');
    // Жилец видит срок ответа датой, а норму по нему, смена.
    assert.equal(seen.json().handoffs[0].basis, undefined);
    assert.equal(seen.json().handoffs[0].dueAt, '2026-09-22T12:00:00.000Z');

    await app.close();
  });

  it('ответ организации записывается и снимает обращение с ожидания', async () => {
    const { app, login } = await setup();
    const token = await login(1001);
    const id = await leak(app, token);
    const staff = await login(5005);

    const passed = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/handoff`,
      headers: authed(staff),
      payload: { to: 'resource' },
    });

    const waiting = await app.inject({ method: 'GET', url: '/api/handoffs', headers: authed(staff) });

    assert.equal(waiting.json().length, 1);

    const answered = await app.inject({
      method: 'POST',
      url: `/api/handoffs/${passed.json().id}/answer`,
      headers: authed(staff),
      payload: { status: 'answered', answer: 'Задвижка заменена' },
    });

    assert.equal(answered.statusCode, 200);
    assert.equal(answered.json().answer, 'Задвижка заменена');

    const empty = await app.inject({ method: 'GET', url: '/api/handoffs', headers: authed(staff) });

    assert.deepEqual(empty.json(), []);

    await app.close();
  });

  it('переданное и ждущее ответа видно в сводке смены', async () => {
    const { app, login } = await setup();
    const id = await leak(app, await login(1001));
    const staff = await login(5005);

    await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/handoff`,
      headers: authed(staff),
      payload: { to: 'resource' },
    });

    const report = await app.inject({ method: 'GET', url: '/api/report', headers: authed(staff) });

    assert.equal(report.statusCode, 200);
    assert.equal(report.json().handoffs.length, 1);
    assert.equal(report.json().handoffs[0].organization, 'Водоканал');

    await app.close();
  });

  it('жилец обращение не передаёт и чужого списка не видит', async () => {
    const { app, login } = await setup();
    const token = await login(1001);
    const id = await leak(app, token);

    const denied = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/handoff`,
      headers: authed(token),
      payload: { to: 'resource' },
    });

    assert.equal(denied.statusCode, 403);

    const list = await app.inject({ method: 'GET', url: '/api/handoffs', headers: authed(token) });

    assert.equal(list.statusCode, 403);

    await app.close();
  });

  it('организации, которой в доме нет, обращение не уходит', async () => {
    const { app, login } = await setup();
    const id = await leak(app, await login(1001));

    const response = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/handoff`,
      headers: authed(await login(5005)),
      payload: { to: 'inspection' },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, 'partner_unknown');

    await app.close();
  });

  it('смежные организации заводит управляющий в карточке дома', async () => {
    const { app, login } = await setup();
    const token = await login(7007);

    const saved = await app.inject({
      method: 'POST',
      url: '/api/buildings/card',
      headers: authed(token),
      payload: {
        partners: [
          { kind: 'resource', title: 'Теплосеть', categories: ['heating'], phone: '+7 900 000-00-00' },
          { kind: 'municipal', title: 'Администрация района' },
        ],
      },
    });

    assert.equal(saved.statusCode, 200);
    assert.deepEqual(
      saved.json().partners.map((partner: { title: string }) => partner.title),
      ['Теплосеть', 'Администрация района'],
    );

    await app.close();
  });
});
