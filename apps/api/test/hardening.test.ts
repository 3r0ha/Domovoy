import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createCollectingNotifier,
  type CapitalRepairPlan,
  type CapitalRepairWork,
  type Resident,
} from '@domovoy/app';
import { signInitData } from '@maxkit/bridge';

import { buildServer, SERVICE_STATUS, STATUS_BY_CODE } from '../dist/index.js';

const BOT_TOKEN = 'api-bot-token';
const BUILDING_ID = 'b1';
/** Дом другой управляющей организации: его квартиры для жильца первого чужие. */
const OTHER_ID = 'b2';

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 1, area: 50 },
  { id: 'far-9', buildingId: OTHER_ID, number: 9, entrance: 1, riser: 1, area: 50 },
];

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const pavel: Resident = {
  id: 'res-pavel',
  maxUserId: 1003,
  displayName: 'Павел Сидоров',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

const manager: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Управляющий',
  role: 'manager',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
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

const setup = async (residents: Resident[] = [], extra: Partial<Parameters<typeof buildServer>[0]> = {}) => {
  let counter = 0;
  let clock = new Date('2026-09-03T10:00:00Z').getTime();

  const repository = new InMemoryRepository({
    buildings: [
      { id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', managementCompany: 'ООО «УК Ленинская»' },
      { id: OTHER_ID, code: 'Д20', address: 'ул. Мира, 20' },
    ],
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
    ...extra,
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

describe('чужое имя в теле запроса', () => {
  it('собрание объявляется от жильца, а не от подставленного управляющего', async () => {
    const { app, login, repository } = await setup([maria, manager]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/polls',
      headers: authed(await login(1001)),
      payload: {
        kind: 'simple',
        title: 'Поставить шлагбаум',
        question: 'Ставим?',
        days: 7,
        resident: { ...manager, role: 'manager' },
      },
    });

    assert.equal(response.statusCode, 403, 'собрание объявляет управляющая организация');
    assert.deepEqual(await repository.listPolls(BUILDING_ID), [], 'собрания от чужого имени не завелось');

    await app.close();
  });

  it('без подставленного поля жильцу собрание всё равно закрыто', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/polls',
      headers: authed(await login(1001)),
      payload: { kind: 'simple', title: 'Поставить шлагбаум', question: 'Ставим?', days: 7 },
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });

  it('подставленное поле в теле до сценария не доходит', async () => {
    const { app, login } = await setup([maria, manager]);
    const token = await login(1001);

    const elder = await app.inject({
      method: 'POST',
      url: '/api/polls/elder',
      headers: authed(token),
      // Кандидат из чужого дома: отказ приходит по кандидату, а не по подставленной роли.
      payload: { candidateId: 'mgr-1', days: 7, resident: manager },
    });

    assert.equal(elder.statusCode, 404);
    assert.equal(elder.json().error, 'candidate_unknown', 'запрос разобран от имени жильца');

    const initiative = await app.inject({
      method: 'POST',
      url: '/api/initiatives',
      headers: authed(token),
      payload: { title: 'Скамейка', question: 'Поставим?', resident: manager },
    });

    assert.equal(initiative.statusCode, 201);
    assert.equal(initiative.json().title, 'Скамейка');

    await app.close();
  });
});

describe('адрес заявки из кода с наклейки', () => {
  it('жилец не заводит заявку на квартиру чужого дома', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(await login(1001)),
      payload: { description: 'Течёт кран', startParam: 'apt_far-9' },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'forbidden');

    await app.close();
  });

  it('квартира соседа по своему дому жильцу закрыта: заявка придёт соседу как своя', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(await login(1001)),
      payload: { description: 'Течёт кран', startParam: 'apt_apt-2' },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'forbidden');

    await app.close();
  });

  it('без привязки к квартире заявку по ней не завести', async () => {
    const { app, login } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(await login(1001)),
      payload: { description: 'Течёт кран', startParam: 'apt_apt-1' },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'apartment_required');

    await app.close();
  });

  it('поле квартиры чужого дома закрыто так же, как код', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(await login(1001)),
      payload: { description: 'Течёт кран', apartmentId: 'far-9' },
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });

  it('смене чужого дома заявка по нему тоже не заводится', async () => {
    const { app, login } = await setup([dispatcher]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(await login(5005)),
      payload: { description: 'Течёт кран', startParam: 'apt_far-9' },
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });
});

describe('имена соседей в жалобе', () => {
  it('сосед идёт ролью, а сотрудники и автор поимённо', async () => {
    const { app, login, advance } = await setup([maria, pavel, dispatcher]);
    const token = await login(1001);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'Нет горячей воды' },
    });

    const id = created.json().request.id as string;

    // Сосед присоединяется к той же заявке и пишет в неё.
    const neighbour = await login(1003);

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(neighbour),
      payload: { description: 'Нет горячей воды' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/comment`,
      headers: authed(neighbour),
      payload: { text: 'У меня то же самое' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(await login(5005)),
      payload: { to: 'accepted' },
    });

    advance(3 * 24 * 3600_000);

    const complaint = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}/complaint`,
      headers: authed(token),
    });

    const text = complaint.json().complaint as string;

    assert.equal(complaint.json().possible, true);
    assert.doesNotMatch(text, /Павел/, 'имя соседа в жалобу третьего лица не попадает');
    assert.match(text, /житель дома/, 'сосед назван ролью');
    assert.match(text, /Ольга/, 'сотрудник управляющей организации назван поимённо');
    assert.match(text, /Мария/, 'заявитель назван поимённо');

    await app.close();
  });
});

describe('передача дома другой организации', () => {
  const handover = (
    app: Awaited<ReturnType<typeof setup>>['app'],
    token: string,
    payload: Record<string, unknown>,
  ) => app.inject({ method: 'POST', url: '/api/buildings/handover', headers: authed(token), payload });

  it('без подтверждения дом остаётся на месте', async () => {
    const { app, login } = await setup([manager, maria]);
    const token = await login(7007);

    const withoutConfirm = await handover(app, token, { company: 'ООО «Новая»', managerId: 'mgr-1' });

    assert.equal(withoutConfirm.statusCode, 400, 'подтверждение обязательно');

    const wrongCompany = await handover(app, token, {
      company: 'ООО «Новая»',
      managerId: 'mgr-1',
      confirm: true,
      current: 'ООО «Не та»',
    });

    assert.equal(wrongCompany.statusCode, 400);
    assert.equal(wrongCompany.json().error, 'wrong_object');

    await app.close();
  });

  it('жильцу отвечают отказом, а не подсказкой, чем подтвердить передачу', async () => {
    const { app, login } = await setup([manager, maria]);

    const response = await handover(app, await login(1001), {
      company: 'ООО «Новая»',
      managerId: 'mgr-1',
      confirm: true,
    });

    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().error, 'forbidden');

    await app.close();
  });

  it('с названием нынешней организации передача проходит', async () => {
    const { app, login } = await setup([manager, maria]);

    const response = await handover(app, await login(7007), {
      company: 'ООО «Новая»',
      managerId: 'mgr-1',
      confirm: true,
      current: 'ООО «УК Ленинская»',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().company, 'ООО «Новая»');

    await app.close();
  });
});

describe('таблица кодов отказа', () => {
  it('служебные коды перечислены рядом с кодами домена и не пересекаются с ними', () => {
    const domain = new Set(Object.keys(STATUS_BY_CODE));

    for (const [code, status] of Object.entries(SERVICE_STATUS)) {
      assert.equal(domain.has(code), false, `${code} есть и в домене`);
      assert.ok(status >= 400 && status < 600, `${code}: ${status}`);
    }
  });

  it('каждый код в ответе API описан в одной из таблиц', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);
    const known = new Set([...Object.keys(STATUS_BY_CODE), ...Object.keys(SERVICE_STATUS)]);

    const answers = await Promise.all([
      app.inject({ method: 'GET', url: '/api/nosuchroute' }),
      app.inject({ method: 'GET', url: '/api/requests/нет-такой', headers: authed(token) }),
      app.inject({ method: 'GET', url: '/api/context/непонятно', headers: authed(token) }),
      app.inject({ method: 'GET', url: '/api/objects/непонятно', headers: authed(token) }),
      app.inject({ method: 'POST', url: '/api/me/notices', headers: authed(token), payload: { kind: 'x', on: true } }),
      app.inject({ method: 'POST', url: '/api/requests', headers: authed(token), payload: {} }),
      // Отказы транспорта: до сценария дело не дошло, отвечает сама библиотека.
      app.inject({
        method: 'POST',
        url: '/api/requests',
        headers: { ...authed(token), 'content-type': 'application/xml' },
        payload: '<заявка/>',
      }),
      app.inject({
        method: 'POST',
        url: '/api/requests',
        headers: { ...authed(token), 'content-type': 'application/json' },
        payload: '{',
      }),
      app.inject({
        method: 'POST',
        url: '/api/files',
        headers: { ...authed(token), 'content-type': 'application/json' },
        payload: JSON.stringify({ contentType: 'image/jpeg', data: 'A'.repeat(3 * 1024 * 1024) }),
      }),
    ]);

    for (const answer of answers) {
      const code = answer.json().error as string;

      assert.ok(known.has(code), `код ${code} в таблицах не описан`);
    }

    await app.close();
  });

  it('неизвестный вид уведомления это разбор запроса, а не пропавший объект', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/notices',
      headers: authed(await login(1001)),
      payload: { kind: 'придуманный', on: false },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'notice_unknown');

    await app.close();
  });
});

describe('отказы транспорта', () => {
  /*
   * У части ручек все поля тела необязательные, и запрос без тела это запрос
   * по умолчанию: «имя» без имени возвращает имя из профиля MAX. Такой запрос
   * упирался в разбор и получал «body must be object» вместо ответа по делу.
   */
  it('запрос без тела доходит до дела, а не до разбора', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    const named = await app.inject({
      method: 'POST',
      url: '/api/me/name',
      headers: authed(token),
      payload: { name: 'Мария Ивановна' },
    });

    assert.equal(named.statusCode, 200, named.body);
    assert.equal(named.json<{ own: boolean }>().own, true);

    const reset = await app.inject({ method: 'POST', url: '/api/me/name', headers: authed(token) });

    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(reset.json<{ own: boolean }>().own, false, 'имя не вернулось к профилю MAX');

    await app.close();
  });

  it('отказ называет недостающее поле, а не тип тела', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(await login(1001)),
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json<{ message: string }>().message, /description/u);

    await app.close();
  });

  it('подпись телефона не из hex отвечает отказом, а не сбоем сервера', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/contact',
      headers: authed(token),
      payload: { phone: '79990001122', authDate: '1756800000', hash: 'ю'.repeat(64) },
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error, 'schema_mismatch');

    await app.close();
  });

  it('подпись телефона из hex, но чужая, не подтверждает номер', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/contact',
      headers: authed(await login(1001)),
      payload: { phone: '79990001122', authDate: '1756800000', hash: 'a'.repeat(64) },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'contact_not_verified');

    await app.close();
  });

  it('битое тело запроса это отказ разбора, а не сбой сервера', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: { ...authed(await login(1001)), 'content-type': 'application/json' },
      payload: '{',
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'body_not_json');

    await app.close();
  });

  it('подстановка в прототип до обработчика не доходит', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/notices',
      headers: { ...authed(await login(1001)), 'content-type': 'application/json' },
      payload: '{"kind":"meters","on":true,"__proto__":{"подставлено":true}}',
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'body_not_json', 'тело отвергнуто на разборе');
    assert.equal(({} as Record<string, unknown>)['подставлено'], undefined, 'прототип остался чистым');

    await app.close();
  });

  it('пустое тело на ручке без обязательных полей принимается', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/logout',
      headers: { ...authed(await login(1001)), 'content-type': 'application/json' },
      payload: '',
    });

    assert.equal(response.statusCode, 204);

    await app.close();
  });

  it('незнакомый тип содержимого отвечает 415, а не сбоем', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    for (const type of ['application/xml', 'чепуха']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/requests',
        headers: { ...authed(token), 'content-type': type },
        payload: '<заявка/>',
      });

      assert.equal(response.statusCode, 415, type);
      assert.equal(response.json().error, 'media_type_unsupported', type);
    }

    await app.close();
  });

  it('тело сверх предела ручки снимков отвечает 413', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/files',
      headers: { ...authed(await login(1001)), 'content-type': 'application/json' },
      payload: JSON.stringify({ contentType: 'image/jpeg', data: 'A'.repeat(3 * 1024 * 1024) }),
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error, 'payload_too_long');

    await app.close();
  });

  it('слишком длинный код объекта в адресе разбирается схемой, а не теряется маршрутом', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'GET',
      url: `/api/context/${'a'.repeat(600)}`,
      headers: authed(await login(1001)),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'schema_mismatch');

    await app.close();
  });
});

describe('токен бота', () => {
  it('без токена сервер не поднимается', async () => {
    await assert.rejects(
      buildServer({
        botToken: '   ',
        repository: new InMemoryRepository({ buildings: [], apartments: [] }),
        defaultBuildingId: BUILDING_ID,
      }),
      /токен бота/i,
    );
  });
});

describe('выход из приложения', () => {
  it('после выхода токен не работает', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) })).statusCode, 200);

    const out = await app.inject({ method: 'POST', url: '/api/me/logout', headers: authed(token) });

    assert.equal(out.statusCode, 204);

    const after = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });

    assert.equal(after.statusCode, 401);
    assert.equal(after.json().error, 'session_invalid');

    await app.close();
  });

  it('удаление профиля закрывает и сессию', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    assert.equal((await app.inject({ method: 'DELETE', url: '/api/me', headers: authed(token) })).statusCode, 204);

    const after = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });

    assert.equal(after.statusCode, 401);
    assert.equal(after.json().error, 'session_invalid', 'токен удалённого профиля не работает');

    await app.close();
  });
});

describe('заголовки приватных ответов', () => {
  it('ответ по токену в общий кеш не кладётся', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({ method: 'GET', url: '/api/me', headers: authed(await login(1001)) });

    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(String(response.headers['vary']), /authorization/i);

    await app.close();
  });

  it('сжатие перечисляет в vary и кодировку, и токен', async () => {
    const { app } = await setup([maria]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/legal',
      headers: { 'accept-encoding': 'gzip' },
    });

    assert.equal(response.headers['content-encoding'], 'gzip');
    assert.match(String(response.headers['vary']), /accept-encoding/i);
    assert.match(String(response.headers['vary']), /authorization/i);

    await app.close();
  });

  it('свой заголовок кеша ручка снимков не теряет', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    const created = await app.inject({
      method: 'POST',
      url: '/api/files',
      headers: authed(token),
      payload: { contentType: 'image/png', data: Buffer.from('снимок').toString('base64') },
    });

    const id = (created.json().token as string).replace('file:', '');
    const file = await app.inject({ method: 'GET', url: `/api/files/${id}`, headers: authed(token) });

    assert.equal(file.statusCode, 200);
    assert.match(String(file.headers['cache-control']), /private/);

    await app.close();
  });
});

describe('границы периода выгрузки', () => {
  it('перевёрнутый и слишком длинный период не принимаются', async () => {
    const { app, login } = await setup([dispatcher]);
    const token = await login(5005);

    const reversed = await app.inject({
      method: 'GET',
      url: '/api/report/requests.csv?from=2026-09-10T00:00:00Z&to=2026-09-01T00:00:00Z',
      headers: authed(token),
    });

    assert.equal(reversed.statusCode, 400);
    assert.equal(reversed.json().error, 'range_invalid');

    const tooLong = await app.inject({
      method: 'GET',
      url: '/api/export/readings.csv?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z',
      headers: authed(token),
    });

    assert.equal(tooLong.statusCode, 400);
    assert.equal(tooLong.json().error, 'range_invalid');

    await app.close();
  });

  it('период в пределах года отдаётся как прежде', async () => {
    const { app, login } = await setup([dispatcher]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/report/requests.csv?from=2026-09-01T00:00:00Z&to=2026-09-10T00:00:00Z',
      headers: authed(await login(5005)),
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /text\/csv/);

    await app.close();
  });
});

describe('схемы параметров пути', () => {
  it('идентификатор в адресе описан схемой', async () => {
    const { app } = await setup();

    const { paths } = await (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
    const parameter = paths['/api/requests/{id}']?.get?.parameters?.[0];

    assert.equal(parameter.name, 'id');
    assert.equal(parameter.schema.maxLength, 100, 'предел длины виден и в описании API');

    await app.close();
  });

  it('номер пункта осмотра приходит числом', async () => {
    const { app, login } = await setup([dispatcher]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/inspections/id-1/items/не-число',
      headers: authed(await login(5005)),
      payload: { state: 'ok' },
    });

    assert.equal(response.statusCode, 400);

    await app.close();
  });
});

describe('капитальный ремонт', () => {
  const works = (list: CapitalRepairWork[]): CapitalRepairPlan => ({
    fund: 'regional',
    contribution: 11.9,
    works: list,
  });

  const plan = {
    title: 'Региональный оператор',
    model: true,
    planFor: () => Promise.resolve(works([{ title: 'Кровля', year: 2030, state: 'planned' }])),
  };

  it('отказ источника отличим от дома вне программы', async () => {
    const { app, login } = await setup([maria], {
      capitalRepair: {
        title: 'Региональный оператор',
        model: true,
        planFor: () => Promise.reject(new Error('источник молчит')),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/capital-repair',
      headers: authed(await login(1001)),
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'capital_unavailable');

    await app.close();
  });

  it('дом вне программы отвечает пустым списком работ', async () => {
    const { app, login } = await setup([maria], {
      capitalRepair: { title: 'Региональный оператор', model: true, planFor: () => Promise.resolve(undefined) },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/capital-repair',
      headers: authed(await login(1001)),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().works, []);

    await app.close();
  });

  it('несуществующий дом отвечает отказом, а не пустотой', async () => {
    const { app, login } = await setup([manager], { capitalRepair: plan });

    const response = await app.inject({
      method: 'GET',
      url: '/api/capital-repair?buildingId=нет-такого',
      headers: authed(await login(7007)),
    });

    assert.equal(response.statusCode, 404);

    await app.close();
  });

  it('список работ источника ответом не переставляется', async () => {
    const mixed: CapitalRepairWork[] = [
      { title: 'Лифт', year: 2032, state: 'planned' },
      { title: 'Кровля', year: 2030, state: 'planned' },
    ];

    const { app, login } = await setup([maria], {
      capitalRepair: {
        title: 'Региональный оператор',
        model: true,
        planFor: () => Promise.resolve(works(mixed)),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/capital-repair',
      headers: authed(await login(1001)),
    });

    assert.deepEqual(
      response.json().works.map((work: { title: string }) => work.title),
      ['Кровля', 'Лифт'],
      'в ответе работы по годам',
    );
    assert.deepEqual(
      mixed.map((work) => work.title),
      ['Лифт', 'Кровля'],
      'список источника остался прежним',
    );

    await app.close();
  });
});

describe('качество работы по выбранному дому', () => {
  it('сотрудник со своей квартирой в другом доме видит выбранный дом', async () => {
    const withFlat: Resident = { ...dispatcher, apartmentId: 'far-9', buildingId: BUILDING_ID };
    const { app, login } = await setup([withFlat]);

    const response = await app.inject({
      method: 'GET',
      url: `/api/quality?buildingId=${BUILDING_ID}`,
      headers: authed(await login(5005)),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().buildingId, BUILDING_ID, 'считается выбранный дом, а не дом квартиры');

    await app.close();
  });
});

describe('обязательные поля ответа', () => {
  it('обращение в поддержку не отвечает пустым телом с кодом 200', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    const created = await app.inject({
      method: 'POST',
      url: '/api/support',
      headers: authed(token),
      payload: { text: 'Когда включат отопление?' },
    });

    assert.equal(created.statusCode, 200);
    assert.ok(created.json().id, 'обращение вернулось целиком');
    assert.equal(created.json().messages.length, 1);

    await app.close();
  });
});

describe('сведения о доме', () => {
  it('в заявке нет полей, которых сериализатор не заполняет', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'Течёт кран' },
    });

    const body = created.json().request;

    for (const dead of ['responsible', 'handoffs', 'targets']) {
      assert.equal(body[dead], undefined, `${dead} в карточке заявки не заполняется`);
    }

    await app.close();
  });

  it('категории заявок берутся из правил домена целиком', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(await login(1001)),
      payload: { description: 'Нужна справка о составе семьи', category: 'document' },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().request.category, 'document');

    await app.close();
  });
});
