import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, createCollectingNotifier, type Resident } from '@domovoy/app';
import { signInitData } from '@maxkit/bridge';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'api-bot-token';
const BUILDING_ID = 'b1';

/** Код первой квартиры из квитанции. */
const CODE = 'ACEFHK34';

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, code: CODE, number: 1, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-3', buildingId: BUILDING_ID, number: 3, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 50 },
];

const withFlat = (id: string, maxUserId: number, apartmentId: string, name: string): Resident => ({
  id,
  maxUserId,
  displayName: name,
  role: 'resident',
  apartmentId,
  buildingId: BUILDING_ID,
});

const maria = withFlat('res-maria', 1001, 'apt-1', 'Мария');
const pavel = withFlat('res-pavel', 1003, 'apt-3', 'Павел');

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const technician: Resident = {
  id: 'tech-1',
  maxUserId: 6006,
  displayName: 'Сергей',
  role: 'technician',
  buildingId: BUILDING_ID,
};

const initDataFor = (userId: number): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `q-${userId}`,
      user: JSON.stringify({ id: userId }),
    },
    BOT_TOKEN,
  );

const setup = async (residents: Resident[]) => {
  let counter = 0;
  let clock = new Date('2026-09-03T10:00:00Z').getTime();

  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
    apartments: APARTMENTS,
    residents,
  });

  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository,
    defaultBuildingId: BUILDING_ID,
    createId: () => `id-${++counter}`,
    now: () => new Date(clock),
    notifier: createCollectingNotifier(),
  });

  const login = async (userId: number): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(userId) },
    });

    return response.json<{ token: string }>().token;
  };

  return { app, login, repository, advance: (ms: number) => (clock += ms) };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

const submit = (app: Awaited<ReturnType<typeof setup>>['app'], token: string, payload: object) =>
  app.inject({ method: 'POST', url: '/api/requests', headers: authed(token), payload });

const transition = (
  app: Awaited<ReturnType<typeof setup>>['app'],
  token: string,
  id: string,
  payload: object,
) => app.inject({ method: 'POST', url: `/api/requests/${id}/transition`, headers: authed(token), payload });

describe('склейка обращений по HTTP', () => {
  it('второе обращение по стояку не создаёт вторую заявку', async () => {
    const { app, login } = await setup([maria, pavel]);

    const first = await submit(app, await login(1001), { description: 'Нет горячей воды' });
    const second = await submit(app, await login(1003), { description: 'Нет горячей воды' });

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 200, 'присоединение, не создание ресурса');
    assert.equal(second.json().joined, true);
    assert.equal(second.json().request.id, first.json().request.id);
    assert.equal(second.json().request.reporters, 2);
    assert.equal(second.json().request.target, 'Подъезд 1, стояк 1', 'адрес поднялся на общее имущество');

    await app.close();
  });

  it('на общей заявке видно, где своё сообщение, а где соседа', async () => {
    const { app, login } = await setup([maria, pavel]);

    const first = await submit(app, await login(1001), { description: 'Нет горячей воды' });
    const id = first.json().request.id as string;
    const neighbour = await login(1003);

    await submit(app, neighbour, { description: 'Нет горячей воды' });
    await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/comment`,
      headers: authed(neighbour),
      payload: { text: 'У меня то же самое с утра' },
    });

    const seen = await app.inject({ method: 'GET', url: `/api/requests/${id}`, headers: authed(await login(1001)) });
    const said = seen.json().history.filter((event: { kind?: string }) => event.kind === 'message');

    assert.deepEqual(
      said.map((event: { speaker?: string }) => event.speaker),
      ['neighbour'],
    );

    const own = await app.inject({ method: 'GET', url: `/api/requests/${id}`, headers: authed(neighbour) });

    assert.equal(own.json().history.at(-1).speaker, 'you');
    assert.equal(JSON.stringify(said).includes(pavel.id), false);

    await app.close();
  });

  it('стук к соседу сверху предлагается только там, где есть кому стучать', async () => {
    const { app, login } = await setup([maria, pavel]);
    const token = await login(1001);

    const flooded = await submit(app, token, {
      description: 'Течёт с потолка в ванной',
      startParam: `apt_${maria.apartmentId}`,
    });
    const id = flooded.json().request.id as string;

    const before = await app.inject({ method: 'GET', url: `/api/requests/${id}`, headers: authed(token) });

    assert.equal(before.json().canKnock, true);
    assert.equal(before.json().knocked, undefined);

    const knock = await app.inject({ method: 'POST', url: `/api/requests/${id}/knock`, headers: authed(token) });

    assert.equal(knock.statusCode, 200);
    assert.equal(knock.json().knocked, true);

    const after = await app.inject({ method: 'GET', url: `/api/requests/${id}`, headers: authed(token) });

    assert.equal(after.json().canKnock, undefined);

    const again = await app.inject({ method: 'POST', url: `/api/requests/${id}/knock`, headers: authed(token) });

    assert.equal(again.statusCode, 409);

    await app.close();
  });

  it('присоединившийся сосед видит заявку у себя', async () => {
    const { app, login } = await setup([maria, pavel]);

    await submit(app, await login(1001), { description: 'Нет горячей воды' });
    const token = await login(1003);
    await submit(app, token, { description: 'Нет горячей воды' });

    const mine = await app.inject({ method: 'GET', url: '/api/requests', headers: authed(token) });

    assert.equal(mine.json().length, 1);

    await app.close();
  });
});

describe('паспорт объекта', () => {
  it('показывает открытые заявки и общее число обращений', async () => {
    const { app, login } = await setup([maria, dispatcher]);
    const token = await login(1001);

    await submit(app, token, { description: 'Лифт не едет', startParam: 'eqp_b1_lift-2' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/objects/eqp_b1_lift-2',
      headers: authed(token),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().target, 'Оборудование lift-2');
    assert.equal(response.json().totalRequests, 1);
    assert.equal(response.json().open.length, 1);

    await app.close();
  });

  it('нераспознанный код, 404', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/objects/ерунда',
      headers: authed(await login(1001)),
    });

    assert.equal(response.statusCode, 404);

    await app.close();
  });
});

describe('приёмка работы', () => {
  it('жилец подтверждает выполнение, а смена, только с объяснением', async () => {
    const { app, login } = await setup([maria, dispatcher, technician]);
    const resident = await login(1001);
    const staff = await login(5005);
    const master = await login(6006);

    const id = (await submit(app, resident, { description: 'Течёт кран', startParam: 'apt_apt-1' })).json().request
      .id as string;

    await transition(app, staff, id, { to: 'accepted' });
    await transition(app, staff, id, { to: 'in_progress', assigneeId: technician.id });
    await transition(app, master, id, { to: 'done', comment: 'Заменил кран' });

    const silent = await transition(app, staff, id, { to: 'confirmed' });
    assert.equal(silent.statusCode, 400, 'молча за жильца работу не принимают');

    const byResident = await transition(app, resident, id, { to: 'confirmed' });
    assert.equal(byResident.json().status, 'confirmed');

    await app.close();
  });

  it('непринятая работа возвращается и считается', async () => {
    const { app, login } = await setup([maria, dispatcher, technician]);
    const resident = await login(1001);
    const staff = await login(5005);

    const id = (await submit(app, resident, { description: 'Течёт кран', startParam: 'apt_apt-1' })).json().request
      .id as string;

    await transition(app, staff, id, { to: 'accepted' });
    await transition(app, staff, id, { to: 'in_progress', assigneeId: technician.id });
    await transition(app, await login(6006), id, { to: 'done', comment: 'Заменил кран' });

    const reopened = await transition(app, resident, id, {
      to: 'in_progress',
      comment: 'Вода так и не появилась',
    });

    assert.equal(reopened.json().status, 'in_progress');
    assert.equal(reopened.json().reopenCount, 1);

    await app.close();
  });
});

describe('очередь с прогнозом', () => {
  it('сотруднику приходит риск и его причина', async () => {
    const { app, login } = await setup([maria, dispatcher]);

    await submit(app, await login(1001), { description: 'Течёт кран', startParam: 'apt_apt-1' });

    const queue = await app.inject({
      method: 'GET',
      url: '/api/requests?scope=queue',
      headers: authed(await login(5005)),
    });

    const [first] = queue.json();

    assert.equal(first.risk, 'none');
    assert.match(first.riskReason, /мало данных/, 'без истории прогноз не выдумывается');

    await app.close();
  });

  it('жильцу прогноз не показывается', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    await submit(app, token, { description: 'Течёт кран', startParam: 'apt_apt-1' });

    const mine = await app.inject({ method: 'GET', url: '/api/requests', headers: authed(token) });

    assert.equal(mine.json()[0].risk, undefined);

    await app.close();
  });

  it('жилец видит, кто ведёт его заявку', async () => {
    const { app, login } = await setup([maria, dispatcher, technician]);
    const residentToken = await login(1001);
    const staffToken = await login(5005);

    const created = await submit(app, residentToken, { description: 'Течёт кран', startParam: 'apt_apt-1' });
    const id = created.json<{ request: { id: string } }>().request.id;

    const before = await app.inject({ method: 'GET', url: `/api/requests/${id}`, headers: authed(residentToken) });

    assert.equal(before.json().assigneeName, undefined, 'пока никому не поручено, и говорить нечего');

    await transition(app, staffToken, id, { to: 'accepted' });
    await transition(app, staffToken, id, { to: 'in_progress', assigneeId: technician.id });

    const after = await app.inject({ method: 'GET', url: `/api/requests/${id}`, headers: authed(residentToken) });

    assert.equal(after.json().assigneeId, technician.id);
    assert.equal(after.json().assigneeName, technician.displayName);

    const list = await app.inject({ method: 'GET', url: '/api/requests', headers: authed(residentToken) });

    assert.equal(list.json()[0].assigneeName, technician.displayName, 'в списке имя тоже есть');

    await app.close();
  });

  it('мастеру прогноз виден и в его собственных нарядах', async () => {
    const { app, login } = await setup([maria, dispatcher, technician]);
    const residentToken = await login(1001);
    const staffToken = await login(5005);

    const created = await submit(app, residentToken, { description: 'Течёт кран', startParam: 'apt_apt-1' });
    const id = created.json<{ request: { id: string } }>().request.id;

    await transition(app, staffToken, id, { to: 'accepted' });
    await transition(app, staffToken, id, { to: 'in_progress', assigneeId: technician.id });

    const naryad = await app.inject({
      method: 'GET',
      url: '/api/requests',
      headers: authed(await login(6006)),
    });

    assert.equal(naryad.json().length, 1);
    assert.ok(naryad.json()[0].riskReason, 'прогноз не пришёл');

    await app.close();
  });
});

describe('привязка к квартире', () => {
  it('код из квитанции открывает счётчики и голосование', async () => {
    const { app, login } = await setup([]);
    const token = await login(1001);

    const before = await app.inject({ method: 'GET', url: '/api/meters', headers: authed(token) });
    assert.equal(before.statusCode, 409, 'квартиры ещё нет: это состояние, а не ошибка запроса');

    const bound = await app.inject({
      method: 'POST',
      url: '/api/me/apartment',
      headers: authed(token),
      payload: { code: CODE },
    });

    assert.equal(bound.statusCode, 200);
    assert.deepEqual(bound.json(), { apartmentId: 'apt-1', number: 1, alreadyBound: false });

    const after = await app.inject({ method: 'GET', url: '/api/meters', headers: authed(token) });
    assert.equal(after.statusCode, 200);

    await app.close();
  });

  it('код не от квартиры не принимается', async () => {
    const { app, login } = await setup([]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/apartment',
      headers: authed(await login(1001)),
      payload: { code: 'ent_b1_1' },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'code_not_apartment');

    await app.close();
  });
});

describe('собрание собственников', () => {
  const manager: Resident = {
    id: 'mgr-1',
    maxUserId: 7007,
    displayName: 'Управляющий',
    role: 'manager',
    buildingId: BUILDING_ID,
  };

  const announce = (app: Awaited<ReturnType<typeof setup>>['app'], token: string) =>
    app.inject({
      method: 'POST',
      url: '/api/polls',
      headers: authed(token),
      payload: {
        kind: 'simple',
        title: 'Ремонт подъездов',
        question: 'Утвердить смету на ремонт подъездов',
        days: 14,
      },
    });

  it('доли считаются по площади, а не по числу голосов', async () => {
    const { app, login, repository } = await setup([maria, pavel, manager]);

    await repository.saveApartment({ ...APARTMENTS[0]!, area: 80 });
    await repository.saveApartment({ ...APARTMENTS[1]!, area: 25 });
    await repository.saveApartment({ ...APARTMENTS[2]!, area: 45 });

    const created = await announce(app, await login(7007));
    const pollId = created.json<{ id: string }>().id;

    assert.equal(created.statusCode, 201);

    const voted = await app.inject({
      method: 'POST',
      url: `/api/polls/${pollId}/vote`,
      headers: authed(await login(1001)),
      payload: { choice: 'for' },
    });
    const body = voted.json();

    assert.equal(body.turnout, 0.5333);
    assert.equal(body.quorum, true);
    assert.equal(body.shares.for, 0.5333);
    assert.equal(body.support, 1);
    assert.equal(body.passed, true);
    assert.equal(body.myChoice, 'for');

    await app.close();
  });

  it('жилец собрание не объявляет', async () => {
    const { app, login } = await setup([maria]);

    const response = await announce(app, await login(1001));

    assert.equal(response.statusCode, 403);

    await app.close();
  });

  it('неизвестный вариант ответа отсекается схемой', async () => {
    const { app, login } = await setup([maria, manager]);

    const created = await announce(app, await login(7007));

    const response = await app.inject({
      method: 'POST',
      url: `/api/polls/${created.json<{ id: string }>().id}/vote`,
      headers: authed(await login(1001)),
      payload: { choice: 'наверное' },
    });

    assert.equal(response.statusCode, 400);

    await app.close();
  });

  it('список показывает идущие собрания', async () => {
    const { app, login } = await setup([maria, manager]);

    await announce(app, await login(7007));

    const response = await app.inject({ method: 'GET', url: '/api/polls', headers: authed(await login(1001)) });
    const [poll] = response.json();

    assert.equal(poll.title, 'Ремонт подъездов');
    assert.equal(poll.kindTitle, 'Простое большинство');
    assert.equal(poll.open, true);

    await app.close();
  });
});

describe('показания счётчиков', () => {
  const withMeters = () => setup([maria]);

  it('счётчики приходят с подписями и прошлым показанием', async () => {
    const { app, login, repository } = await withMeters();

    await repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    const token = await login(1001);

    await app.inject({
      method: 'POST',
      url: '/api/meters/cold-1/readings',
      headers: authed(token),
      payload: { value: 120.5 },
    });

    const response = await app.inject({ method: 'GET', url: '/api/meters', headers: authed(token) });
    const [meter] = response.json();

    assert.equal(meter.title, 'Холодная вода');
    assert.equal(meter.unit, 'м³');
    assert.equal(meter.lastValue, 120.5);
    assert.equal(meter.submittedThisMonth, true);
    assert.equal(meter.verification, 'ok');

    await app.close();
  });

  it('состояние поверки приходит вместе со счётчиком', async () => {
    const { app, login, repository } = await withMeters();

    await repository.saveMeter({
      id: 'cold-1',
      apartmentId: 'apt-1',
      kind: 'cold_water',
      serial: 'ХВС-1',
      verifiedUntil: new Date('2020-01-01T00:00:00Z'),
    });

    const token = await login(1001);
    const response = await app.inject({ method: 'GET', url: '/api/meters', headers: authed(token) });
    const [meter] = response.json();

    assert.equal(meter.verification, 'expired');
    assert.equal(meter.verifiedUntil, '2020-01-01T00:00:00.000Z');

    await app.close();
  });

  it('показание меньше прошлого не принимается', async () => {
    const { app, login, repository } = await withMeters();

    await repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await repository.saveReading({
      id: 'r-past',
      meterId: 'cold-1',
      value: 120,
      at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      submittedBy: 'res-maria',
    });

    const token = await login(1001);

    const response = await app.inject({
      method: 'POST',
      url: '/api/meters/cold-1/readings',
      headers: authed(token),
      payload: { value: 100 },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'reading_decreased', 'счётчик не крутится назад');

    await app.close();
  });

  it('повторное показание за месяц исправляет поданное', async () => {
    const { app, login, repository } = await withMeters();

    await repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    const token = await login(1001);
    const send = (value: number) =>
      app.inject({
        method: 'POST',
        url: '/api/meters/cold-1/readings',
        headers: authed(token),
        payload: { value },
      });

    await send(1200);
    const again = await send(125);

    assert.equal(again.statusCode, 201);
    assert.equal(await repository.listReadings('cold-1').then((list) => list.length), 1);

    const meters = await app.inject({ method: 'GET', url: '/api/meters', headers: authed(token) });

    assert.equal(meters.json()[0].lastValue, 125);

    await app.close();
  });

  it('отрицательное показание отсекается схемой', async () => {
    const { app, login, repository } = await withMeters();

    await repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/meters/cold-1/readings',
      headers: authed(await login(1001)),
      payload: { value: -1 },
    });

    assert.equal(response.statusCode, 400);

    await app.close();
  });

  it('без квартиры счётчиков нет', async () => {
    const { app, login } = await setup([]);

    const response = await app.inject({ method: 'GET', url: '/api/meters', headers: authed(await login(1001)) });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, 'apartment_not_bound');

    await app.close();
  });
});

describe('сводка по дому', () => {
  it('сотрудник видит то, чего не видно в списке заявок', async () => {
    const { app, login, advance } = await setup([maria, pavel, dispatcher, technician]);

    await submit(app, await login(1001), { description: 'Нет горячей воды' });
    await submit(app, await login(1003), { description: 'Нет горячей воды' });
    advance(100 * 3600_000);

    const response = await app.inject({
      method: 'GET',
      url: '/api/report',
      headers: authed(await login(5005)),
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.summary.total, 1, 'два обращения, одна заявка');
    assert.equal(body.summary.mergedReports, 1);
    assert.equal(body.summary.overdue, 1);
    assert.equal(body.incidents[0].reporters, 2);
    assert.equal(body.categories[0].title, 'Водоснабжение и канализация');
    assert.equal(body.categories[0].overdueRate, 1);

    await app.close();
  });

  it('исполнители приходят с загрузкой, свободные первыми', async () => {
    const { app, login } = await setup([maria, dispatcher, technician]);
    const resident = await login(1001);
    const staffToken = await login(5005);
    await login(6006);

    const id = (await submit(app, resident, { description: 'Течёт кран', startParam: 'apt_apt-1' })).json().request
      .id as string;

    await transition(app, staffToken, id, { to: 'accepted' });
    await transition(app, staffToken, id, { to: 'in_progress', assigneeId: 'tech-1' });

    const response = await app.inject({ method: 'GET', url: '/api/staff', headers: authed(staffToken) });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      body.map((person: { displayName: string; load: number }) => [person.displayName, person.load]),
      [
        ['Ольга', 0],
        ['Сергей', 1],
      ],
    );

    await app.close();
  });

  it('жильцу список исполнителей недоступен', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({ method: 'GET', url: '/api/staff', headers: authed(await login(1001)) });

    assert.equal(response.statusCode, 403);

    await app.close();
  });

  it('жильцу сводка недоступна', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/report',
      headers: authed(await login(1001)),
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });
});

describe('обращение в жилинспекцию', () => {
  it('появляется только после нарушения срока', async () => {
    const { app, login, advance } = await setup([maria]);
    const token = await login(1001);

    const id = (await submit(app, token, { description: 'Течёт кран', startParam: 'apt_apt-1' })).json().request
      .id as string;

    const early = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}/complaint`,
      headers: authed(token),
    });

    assert.equal(early.json().possible, false);
    assert.equal(early.json().complaint, undefined);

    advance(2 * 3600_000);

    const late = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}/complaint`,
      headers: authed(token),
    });

    assert.equal(late.json().possible, true);
    assert.match(late.json().complaint, /Государственную жилищную инспекцию/);
    assert.match(late.json().complaint, /ул\. Ленина, 15/);

    await app.close();
  });

  it('по чужой заявке обращение не составить', async () => {
    const { app, login, advance } = await setup([maria, pavel]);

    const id = (
      await submit(app, await login(1001), { description: 'Течёт кран', startParam: 'apt_apt-1' })
    ).json().request.id as string;

    advance(2 * 3600_000);

    const response = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}/complaint`,
      headers: authed(await login(1003)),
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });
});

describe('вложения', () => {
  it('фото и расшифровка голосового доезжают до заявки', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    const created = await submit(app, token, {
      description: 'Не работает лифт',
      startParam: 'ent_b1_1',
      attachments: [
        { kind: 'photo', token: 'photo-token' },
        { kind: 'voice', token: 'voice-token', transcript: 'не работает лифт в первом подъезде' },
      ],
    });

    assert.deepEqual(created.json().request.attachments, [
      { kind: 'photo', token: 'photo-token' },
      { kind: 'voice', token: 'voice-token', transcript: 'не работает лифт в первом подъезде' },
    ]);

    await app.close();
  });

  it('неизвестный вид вложения схема не пропускает', async () => {
    const { app, login } = await setup([maria]);

    const response = await submit(app, await login(1001), {
      description: 'Течёт кран',
      startParam: 'apt_apt-1',
      attachments: [{ kind: 'видео', token: 'x' }],
    });

    assert.equal(response.statusCode, 400);

    await app.close();
  });
});

describe('плановые работы по HTTP', () => {
  const announce = (app: Awaited<ReturnType<typeof setup>>['app'], token: string, works: object) =>
    app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: authed(token),
      payload: {
        title: 'Замена задвижки',
        body: 'Отключение горячей воды на время работ',
        entrance: 1,
        riser: 1,
        works,
      },
    });

  const nowWorks = () => ({
    category: 'plumbing',
    from: new Date('2026-09-03T09:00:00Z').toISOString(),
    until: new Date('2026-09-03T14:00:00Z').toISOString(),
  });

  it('обращение во время работ возвращает срок вместо заявки', async () => {
    const { app, login } = await setup([maria, dispatcher]);

    assert.equal((await announce(app, await login(5005), nowWorks())).statusCode, 201);

    const response = await submit(app, await login(1001), { description: 'Нет горячей воды' });

    assert.equal(response.statusCode, 200, 'заявка не создавалась');
    assert.equal(response.json().joined, false);
    assert.match(response.json().planned.message, /плановые работы до/);
    assert.equal(response.json().planned.category, 'plumbing');
    assert.equal(response.json().request, undefined);

    await app.close();
  });

  it('настояние жильца заводит заявку', async () => {
    const { app, login } = await setup([maria, dispatcher]);

    await announce(app, await login(5005), nowWorks());

    const response = await submit(app, await login(1001), {
      description: 'Нет воды, и в подвале хлещет',
      anyway: true,
    });

    assert.equal(response.statusCode, 201);
    assert.ok(response.json().request.number);

    await app.close();
  });

  it('работы с концом раньше начала не публикуются', async () => {
    const { app, login } = await setup([dispatcher]);

    const response = await announce(app, await login(5005), {
      category: 'plumbing',
      from: new Date('2026-09-03T14:00:00Z').toISOString(),
      until: new Date('2026-09-03T09:00:00Z').toISOString(),
    });

    assert.equal(response.statusCode, 400);

    await app.close();
  });

  it('срок работ виден в списке объявлений', async () => {
    const { app, login } = await setup([maria, dispatcher]);

    await announce(app, await login(5005), nowWorks());

    const list = await app.inject({
      method: 'GET',
      url: '/api/announcements',
      headers: authed(await login(1001)),
    });

    assert.equal(list.json()[0].works.category, 'plumbing');
    assert.equal(list.json()[0].works.until, '2026-09-03T14:00:00.000Z');

    await app.close();
  });
});

describe('дом глазами жильца', () => {
  it('работа управляющей компании доступна жильцу, а не только сотрудникам', async () => {
    const { app, login } = await setup([maria, dispatcher]);
    const token = await login(1001);

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'Течёт кран' },
    });

    const response = await app.inject({ method: 'GET', url: '/api/quality', headers: authed(token) });

    assert.equal(response.statusCode, 200);

    const quality = response.json();

    assert.equal(quality.created, 1);
    assert.equal(quality.open, 1);
    assert.equal(quality.closed, 0);
    assert.equal(typeof quality.from, 'string');
    assert.equal(typeof quality.rated, 'number');
    assert.equal('inTimeRate' in quality, false);
    assert.equal('averageRating' in quality, false);

    assert.equal((await app.inject({ method: 'GET', url: '/api/report', headers: authed(token) })).statusCode, 403);

    await app.close();
  });

  it('лента «что будет» отдаёт работы, собрания и обходы одним списком', async () => {
    const { app, login } = await setup([maria, dispatcher]);
    const staff = await login(5005);

    await app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: authed(staff),
      payload: {
        title: 'Промывка отопления',
        body: 'В четверг',
        works: {
          category: 'heating',
          from: new Date('2026-09-05T07:00:00Z').toISOString(),
          until: new Date('2026-09-05T13:00:00Z').toISOString(),
        },
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/ahead', headers: authed(await login(1001)) });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.json().map((event: { kind: string; title: string; where: string }) => [
        event.kind,
        event.title,
        event.where,
      ]),
      [['works', 'Промывка отопления', 'весь дом']],
    );
  });

  it('заявку соседа по общему имуществу можно поддержать, а по квартире, нет', async () => {
    const { app, login } = await setup([maria, pavel, dispatcher]);
    const author = await login(1001);
    const neighbour = await login(1003);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(author),
      payload: { description: 'Не убрана площадка', startParam: 'ent_b1_1' },
    });

    const requestId = created.json().request.id;

    const house = await app.inject({ method: 'GET', url: '/api/requests/house', headers: authed(neighbour) });

    assert.equal(house.statusCode, 200);
    assert.deepEqual(
      house.json().map((item: { id: string }) => item.id),
      [requestId],
    );

    const supported = await app.inject({
      method: 'POST',
      url: `/api/requests/${requestId}/support`,
      headers: authed(neighbour),
    });

    assert.equal(supported.statusCode, 200);
    assert.equal(supported.json().reporters, 2);

    const again = await app.inject({ method: 'GET', url: '/api/requests/house', headers: authed(neighbour) });

    assert.deepEqual(again.json(), []);

    assert.deepEqual(
      (await app.inject({ method: 'GET', url: '/api/requests/house', headers: authed(author) })).json(),
      [],
    );

    await app.close();
  });

  it('чужую квартиру поддержать нельзя', async () => {
    const { app, login } = await setup([maria, pavel, dispatcher]);
    const author = await login(1001);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(author),
      payload: { description: 'Течёт кран на кухне' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/requests/${created.json().request.id}/support`,
      headers: authed(await login(1003)),
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });
});

describe('общедомовой узел учёта', () => {
  const nina: Resident = {
    id: 'mgr-1',
    maxUserId: 7007,
    displayName: 'Нина',
    role: 'manager',
    buildingId: BUILDING_ID,
  };

  it('управляющая компания заводит прибор и снимает показание', async () => {
    const { app, login } = await setup([nina]);
    const token = await login(7007);

    const created = await app.inject({
      method: 'POST',
      url: '/api/house-meters',
      headers: authed(token),
      payload: { kind: 'cold_water', serial: 'ОДПУ-1' },
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.json().title, 'Холодная вода');
    assert.equal(created.json().verification, 'ok');

    const reading = await app.inject({
      method: 'POST',
      url: `/api/house-meters/${created.json().id}/readings`,
      headers: authed(token),
      payload: { value: 1000 },
    });

    assert.equal(reading.statusCode, 201);

    const list = await app.inject({ method: 'GET', url: '/api/house-meters', headers: authed(token) });

    assert.equal(list.json()[0].lastValue, 1000);
    assert.equal(list.json()[0].submittedThisMonth, true);
  });

  it('жильцу узел учёта не показывают и завести прибор не дают', async () => {
    const { app, login } = await setup([maria, nina]);
    const token = await login(1001);

    const list = await app.inject({ method: 'GET', url: '/api/house-meters', headers: authed(token) });
    const created = await app.inject({
      method: 'POST',
      url: '/api/house-meters',
      headers: authed(token),
      payload: { kind: 'cold_water', serial: 'ОДПУ-1' },
    });

    assert.equal(list.statusCode, 403);
    assert.equal(created.statusCode, 403);
  });

  it('неизвестный ресурс схема не пропускает', async () => {
    const { app, login } = await setup([nina]);
    const token = await login(7007);

    const created = await app.inject({
      method: 'POST',
      url: '/api/house-meters',
      headers: authed(token),
      payload: { kind: 'воздух', serial: 'ОДПУ-1' },
    });

    assert.equal(created.statusCode, 400);
  });

  it('общедомовая строка доезжает до квитанции жильца', async () => {
    const { app, login, repository } = await setup([maria, nina]);

    await repository.saveApartment({ ...APARTMENTS[0]!, area: 50 });
    await repository.saveApartment({ ...APARTMENTS[1]!, area: 150 });
    await repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await repository.saveHouseMeter({
      id: 'house-cold',
      buildingId: BUILDING_ID,
      kind: 'cold_water',
      serial: 'ОДПУ-1',
    });

    for (const [id, meterId, value, day] of [
      ['r-0', 'cold-1', 200, '2026-07-20'],
      ['r-1', 'cold-1', 220, '2026-08-20'],
    ] as const) {
      await repository.saveReading({ id, meterId, value, at: new Date(`${day}T10:00:00Z`), submittedBy: maria.id });
    }

    for (const [id, value, day] of [
      ['hr-0', 1000, '2026-07-20'],
      ['hr-1', 1100, '2026-08-20'],
    ] as const) {
      await repository.saveHouseReading({
        id,
        meterId: 'house-cold',
        value,
        at: new Date(`${day}T10:00:00Z`),
        submittedBy: nina.id,
      });
    }

    const token = await login(1001);
    const charges = await app.inject({ method: 'GET', url: '/api/charges', headers: authed(token) });
    const line = charges
      .json<{ lines: { title: string; amount: number }[] }>()
      .lines.find((item) => item.title.includes('ОДН'));

    assert.ok(line, 'общедомовой строки в квитанции нет');
    assert.equal(line.title, 'Холодная вода, ОДН');
  });
});

describe('долги дома', () => {
  const nina: Resident = {
    id: 'mgr-1',
    maxUserId: 7007,
    displayName: 'Нина',
    role: 'manager',
    buildingId: BUILDING_ID,
  };

  /** Полгода начислений и ни одной оплаты: столько же, сколько считает продукт. */
  const withDebt = async () => {
    const state = await setup([maria, nina]);

    await state.repository.saveApartment({ ...APARTMENTS[0]!, area: 50 });
    await state.app.inject({
      method: 'POST',
      url: '/api/tariffs',
      headers: authed(await state.login(7007)),
      payload: { kind: 'maintenance', value: 40 },
    });

    return state;
  };

  it('управляющая видит должников с пенями и месяцами', async () => {
    const { app, login } = await withDebt();

    const response = await app.inject({
      method: 'GET',
      url: '/api/debtors',
      headers: authed(await login(7007)),
    });

    assert.equal(response.statusCode, 200);

    const debt = response.json<{
      total: number;
      penalty: number;
      debtors: { displayName: string; apartmentNumber: number; months: string; overdueDays: number }[];
    }>();
    const [first] = debt.debtors;

    assert.ok(debt.total > 0, 'долг дома не посчитан');
    assert.equal(first?.displayName, 'Мария');
    assert.equal(first?.apartmentNumber, 1);
    assert.match(first?.months ?? '', /2026/);
    assert.ok((first?.overdueDays ?? 0) > 0);

    await app.close();
  });

  it('жильцу список должников закрыт', async () => {
    const { app, login } = await withDebt();

    const response = await app.inject({
      method: 'GET',
      url: '/api/debtors',
      headers: authed(await login(1001)),
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });

  it('напоминание уходит одному должнику', async () => {
    const { app, login } = await withDebt();

    const response = await app.inject({
      method: 'POST',
      url: `/api/debtors/${maria.id}/remind`,
      headers: authed(await login(7007)),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().displayName, 'Мария');

    await app.close();
  });
});
