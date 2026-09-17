import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, createCollectingNotifier, type Resident } from '@domovoy/app';
import { LEGAL_VERSION } from '@domovoy/domain';
import { signInitData } from '@maxkit/bridge';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'api-bot-token';
const BUILDING_ID = 'b1';

const APARTMENTS = [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 }];

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Диспетчер',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const initDataFor = (userId: number, user: Record<string, unknown> = {}): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `q-${userId}`,
      user: JSON.stringify({ id: userId, ...user }),
    },
    BOT_TOKEN,
  );

const setup = async (residents: Resident[] = []) => {
  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15' }],
    apartments: APARTMENTS,
    residents,
  });

  const notifier = createCollectingNotifier();
  let counter = 0;

  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository,
    defaultBuildingId: BUILDING_ID,
    createId: () => `id-${++counter}`,
    notifier,
  });

  const login = async (userId: number, user?: Record<string, unknown>): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(userId, user) },
    });

    return response.json<{ token: string }>().token;
  };

  return { app, repository, notifier, login };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

describe('имя жильца при входе', () => {
  it('склеивается из имени и фамилии', async () => {
    const { app } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(1001, { first_name: 'Мария', last_name: 'Иванова' }) },
    });

    assert.equal(response.json().displayName, 'Мария Иванова');
    await app.close();
  });

  it('без имени подставляется нейтральное обращение', async () => {
    const { app } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(1001) },
    });

    assert.equal(response.json().displayName, 'Жилец');
    await app.close();
  });
});

describe('сбой хранилища', () => {
  it('отвечает 500 без подробностей и не роняет сервер', async () => {
    const { app, login, repository } = await setup([dispatcher]);
    const staff = authed(await login(5005));

    repository.listRequests = () => Promise.reject(new Error('база недоступна: подробности из лога'));

    const failed = await app.inject({ method: 'GET', url: '/api/requests?scope=queue', headers: staff });

    assert.equal(failed.statusCode, 500);
    assert.deepEqual(failed.json(), { error: 'internal', message: 'Внутренняя ошибка' });

    const alive = await app.inject({ method: 'GET', url: '/api/me', headers: staff });

    assert.equal(alive.statusCode, 200, 'следующий запрос обслуживается как обычно');

    await app.close();
  });
});

describe('коды ошибок отражают смысл', () => {
  it('закрытую заявку трогать нельзя, 409', async () => {
    const { app, login } = await setup([dispatcher]);
    const resident = await login(1001, { first_name: 'Мария' });
    const staff = await login(5005);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'Течёт кран', startParam: 'apt_apt-1' },
    });
    const id = created.json<{ request: { id: string } }>().request.id;

    await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(staff),
      payload: { to: 'rejected', comment: 'Не относится к общему имуществу' },
    });

    const again = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(staff),
      payload: { to: 'accepted' },
    });

    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error, 'request_closed');

    await app.close();
  });

  it('невозможный переход, тоже 409', async () => {
    const { app, login } = await setup([dispatcher]);
    const resident = await login(1001, { first_name: 'Мария' });
    const staff = await login(5005);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'Течёт кран', startParam: 'apt_apt-1' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/requests/${created.json<{ request: { id: string } }>().request.id}/transition`,
      headers: authed(staff),
      payload: { to: 'done' },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, 'transition_not_allowed');

    await app.close();
  });

  it('перевод несуществующей заявки, 404', async () => {
    const { app, login } = await setup([dispatcher]);
    const staff = await login(5005);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests/нет-такой/transition',
      headers: authed(staff),
      payload: { to: 'accepted' },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, 'request_not_found');

    await app.close();
  });

  it('чтение несуществующей заявки, 404', async () => {
    const { app, login } = await setup();
    const token = await login(1001, { first_name: 'Мария' });

    const response = await app.inject({ method: 'GET', url: '/api/requests/нет-такой', headers: authed(token) });

    assert.equal(response.statusCode, 404);
    await app.close();
  });

  it('свою заявку автор читает целиком', async () => {
    const { app, login } = await setup();
    const token = await login(1001, { first_name: 'Мария' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'Течёт кран', startParam: 'apt_apt-1' },
    });
    const id = created.json<{ request: { id: string } }>().request.id;

    const response = await app.inject({ method: 'GET', url: `/api/requests/${id}`, headers: authed(token) });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.id, id);
    assert.equal(body.status, 'new');
    assert.equal(body.overdue, false);
    assert.match(body.number, /^Д15-/);

    assert.equal(body.dueAt, body.reactionDueAt);
    assert.ok(new Date(body.reactionDueAt) < new Date(body.resolutionDueAt));

    await app.close();
  });

  it('после приёма на кону уже срок выполнения', async () => {
    const { app, login } = await setup([dispatcher]);
    const resident = await login(1001, { first_name: 'Мария' });
    const staff = await login(5005);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'Течёт кран', startParam: 'apt_apt-1' },
    });

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/requests/${created.json<{ request: { id: string } }>().request.id}/transition`,
      headers: authed(staff),
      payload: { to: 'accepted' },
    });
    const body = accepted.json();

    assert.equal(body.dueAt, body.resolutionDueAt);
    assert.equal(body.reactionOverdue, false);

    await app.close();
  });

  it('неизвестный статус отсекается схемой до домена', async () => {
    const { app, login } = await setup([dispatcher]);
    const staff = await login(5005);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests/whatever/transition',
      headers: authed(staff),
      payload: { to: 'улетела' },
    });

    assert.equal(response.statusCode, 400);
    await app.close();
  });
});

describe('доступ с адреса мини-приложения', () => {
  const withOrigins = async (allowedOrigins: string[]) =>
    buildServer({
      botToken: BOT_TOKEN,
      repository: new InMemoryRepository({
        buildings: [{ id: BUILDING_ID, code: 'Д15' }],
        apartments: APARTMENTS,
      }),
      defaultBuildingId: BUILDING_ID,
      allowedOrigins,
    });

  it('разрешённый источник получает заголовки и проходит предварительный запрос', async () => {
    const app = await withOrigins(['https://app.example']);

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/requests',
      headers: {
        origin: 'https://app.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    assert.equal(preflight.headers['access-control-allow-origin'], 'https://app.example');
    assert.match(String(preflight.headers['access-control-allow-headers']), /authorization/);

    assert.match(String(preflight.headers['access-control-allow-headers']), /x-max-init-data/);

    await app.close();
  });

  it('удаление профиля проходит предварительный запрос', async () => {
    const app = await withOrigins(['https://app.example']);

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/me',
      headers: {
        origin: 'https://app.example',
        'access-control-request-method': 'DELETE',
        'access-control-request-headers': 'authorization',
      },
    });

    assert.match(String(preflight.headers['access-control-allow-methods']), /DELETE/);

    await app.close();
  });

  it('чужой источник разрешения не получает', async () => {
    const app = await withOrigins(['https://app.example']);

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://чужой.example' },
    });

    assert.equal(response.headers['access-control-allow-origin'], undefined);

    await app.close();
  });

  it('без списка источников заголовки не выдаются вовсе', async () => {
    const app = await withOrigins([]);

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], undefined);

    await app.close();
  });
});

describe('лента объявлений', () => {
  const manager: Resident = {
    id: 'mgr-1',
    maxUserId: 7007,
    displayName: 'Управляющий',
    role: 'manager',
    buildingId: BUILDING_ID,
  };

  it('жилец читает объявления, адресованные ему', async () => {
    const { app, login } = await setup([manager]);
    const staff = await login(7007);

    await app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: authed(staff),
      payload: { title: 'Отключение воды', body: 'Завтра с 9 до 14', entrance: 1, riser: 1 },
    });

    const token = await login(1001, { first_name: 'Мария' });

    const before = await app.inject({ method: 'GET', url: '/api/announcements', headers: authed(token) });
    assert.deepEqual(before.json(), []);

    await app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: authed(staff),
      payload: { title: 'Собрание собственников', body: 'В четверг во дворе' },
    });

    const after = await app.inject({ method: 'GET', url: '/api/announcements', headers: authed(token) });
    const [first] = after.json();

    assert.equal(after.statusCode, 200);
    assert.equal(first.title, 'Собрание собственников');
    assert.equal(first.audience, 'весь дом');
    assert.equal(first.recipients, 1);
    assert.ok(first.createdAt);

    await app.close();
  });

  it('адресат приходит словами, а не структурой', async () => {
    const { app, login } = await setup([manager]);
    const staff = await login(7007);

    await app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: authed(staff),
      payload: { title: 'Отключение воды', body: 'Завтра с 9 до 14', entrance: 1, riser: 1 },
    });

    const [first] = (await app.inject({ method: 'GET', url: '/api/announcements', headers: authed(staff) })).json();

    assert.equal(first.audience, 'подъезд 1, стояк 1');

    await app.close();
  });
});

describe('профиль и уведомления', () => {
  it('профиль отдаёт роль и привязку к квартире', async () => {
    const withFlat: Resident = {
      id: 'res-1',
      maxUserId: 1001,
      displayName: 'Мария',
      role: 'resident',
      apartmentId: 'apt-1',
      buildingId: BUILDING_ID,
    };

    const { app, login } = await setup([withFlat]);
    const token = await login(1001);

    const response = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });

    assert.deepEqual(response.json(), {
      id: 'res-1',
      displayName: 'Мария',
      role: 'resident',
      apartmentId: 'apt-1',
      apartmentNumber: 1,
      readingWindow: { fromDay: 20, toDay: 25 },
      meterPhoto: false,
      reception: false,
      files: true,
      demo: false,
      payments: false,
      doors: false,
      model: [],
      legal: { version: LEGAL_VERSION, accepted: false },
    });

    await app.close();
  });

  it('перевод статуса из приложения доходит до жильца', async () => {
    const { app, login, notifier } = await setup([dispatcher]);
    const resident = await login(1001, { first_name: 'Мария' });
    const staff = await login(5005);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'Течёт кран', startParam: 'apt_apt-1' },
    });

    await app.inject({
      method: 'POST',
      url: `/api/requests/${created.json<{ request: { id: string } }>().request.id}/transition`,
      headers: authed(staff),
      payload: { to: 'accepted' },
    });

    const toResident = notifier.sent.filter((item) => item.maxUserId === 1001);

    assert.equal(toResident.length, 1);
    assert.match(toResident[0]?.text ?? '', /принята в работу/);

    await app.close();
  });

  it('о новой заявке узнаёт диспетчер, а не только автор', async () => {
    const { app, login, notifier } = await setup([dispatcher]);
    const resident = await login(1001, { first_name: 'Мария' });
    await login(5005);

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'Течёт кран', startParam: 'apt_apt-1' },
    });

    const toStaff = notifier.sent.filter((item) => item.maxUserId === 5005);

    assert.equal(toStaff.length, 1);
    assert.match(toStaff[0]?.text ?? '', /Новая заявка: /);
    assert.match(toStaff[0]?.text ?? '', /Д15-/);
    assert.equal(
      notifier.sent.some((item) => item.maxUserId === 1001),
      false,
      'автору не пересказываем то, что он только что сделал',
    );

    await app.close();
  });
});

describe('роли и дома сотрудников по HTTP', () => {
  it('подрядчик назначается: роль есть в продукте, значит и в схеме', async () => {
    const harness = await setup([
      { id: 'mgr-1', maxUserId: 7007, displayName: 'Нина', role: 'manager', buildingId: BUILDING_ID },
      { id: 'res-1', maxUserId: 1001, displayName: 'Мария', role: 'resident', buildingId: BUILDING_ID },
    ]);

    const token = await harness.login(7007);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/residents/res-1/role',
      headers: authed(token),
      payload: { role: 'contractor' },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().role, 'contractor');

    await harness.app.close();
  });

  it('дома сотрудника доезжают до клиента, а не режутся схемой', async () => {
    const harness = await setup([
      { id: 'mgr-1', maxUserId: 7007, displayName: 'Нина', role: 'manager', buildingId: BUILDING_ID },
      { id: 'disp-1', maxUserId: 5005, displayName: 'Ольга', role: 'dispatcher', buildingId: BUILDING_ID },
    ]);

    const token = await harness.login(7007);
    const people = await harness.app.inject({ method: 'GET', url: '/api/residents', headers: authed(token) });

    assert.deepEqual(
      people.json().find((person: { id: string }) => person.id === 'disp-1').buildingIds,
      [BUILDING_ID],
      'свой дом приходит всегда',
    );

    await harness.app.close();
  });
});
