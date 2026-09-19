import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, inflateRawSync } from 'node:zlib';

import { signInitData } from '@maxkit/bridge';
import type { FastifyInstance } from 'fastify';

import { InMemoryRepository, createMockHub, type Resident } from '@domovoy/app';

import { buildServer } from '../dist/index.js';

/** Достаёт один файл из zip: книгу Excel иначе не проверить. */
const unpack = (archive: Buffer, name: string): string => {
  const marker = Buffer.from(name, 'utf8');

  for (let at = 0; at < archive.length - 4; at += 1) {
    if (archive.readUInt32LE(at) !== 0x04_03_4b_50) continue;

    const nameLength = archive.readUInt16LE(at + 26);
    const extraLength = archive.readUInt16LE(at + 28);
    const start = at + 30;

    if (!archive.subarray(start, start + nameLength).equals(marker)) continue;

    const from = start + nameLength + extraLength;

    return inflateRawSync(archive.subarray(from, from + archive.readUInt32LE(at + 18))).toString('utf8');
  }

  throw new Error(`В книге нет файла ${name}`);
};

const BOT_TOKEN = 'api-bot-token';
const BUILDING_ID = 'b1';

/** Коды квартир из квитанций: ими жилец и привязывается. */
const CODES = { first: 'ACEFHK34', second: 'LMNPRT47', twentieth: 'UVWXY349' };

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, code: CODES.first, number: 1, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-2', buildingId: BUILDING_ID, code: CODES.second, number: 2, entrance: 1, riser: 2, area: 50 },
  { id: 'apt-3', buildingId: BUILDING_ID, code: CODES.twentieth, number: 20, entrance: 2, riser: 1, area: 50 },
];

/** Жилец первой квартиры: заявку по квартире заводит только тот, кто к ней привязан. */
const tenant: Resident = {
  id: 'res-tenant',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const initDataFor = (userId: number, name = 'Жилец'): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `q-${userId}`,
      user: JSON.stringify({ id: userId, first_name: name }),
    },
    BOT_TOKEN,
  );

interface Harness {
  app: FastifyInstance;
  repository: InMemoryRepository;
  login: (userId: number, name?: string) => Promise<string>;
}

const setup = async (residents: Resident[] = []): Promise<Harness> => {
  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15' }],
    apartments: APARTMENTS,
    residents,
  });

  let counter = 0;
  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository,
    defaultBuildingId: BUILDING_ID,
    createId: () => `id-${++counter}`,
  });

  const login = async (userId: number, name?: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(userId, name) },
    });

    assert.equal(response.statusCode, 200, `вход не удался: ${response.body}`);
    return response.json<{ token: string }>().token;
  };

  return { app, repository, login };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

describe('лендинг и приложение с того же адреса', () => {
  /** Две папки статики: одна за лендинг, другая за мини-приложение. */
  const site = async (): Promise<{ app: FastifyInstance; clean: () => Promise<void> }> => {
    const root = await mkdtemp(join(tmpdir(), 'domovoy-web-'));

    await mkdir(join(root, 'landing'));
    await mkdir(join(root, 'miniapp'));
    await writeFile(join(root, 'landing', 'index.html'), '<!doctype html><title>Домовой</title>');
    await writeFile(join(root, 'landing', '404.html'), '<!doctype html><title>Страницы нет</title>');
    await writeFile(join(root, 'miniapp', 'index.html'), '<!doctype html><title>Приложение</title>');
    await mkdir(join(root, 'miniapp', 'assets'));
    await writeFile(join(root, 'miniapp', 'assets', 'app.js'), 'console.log("Домовой")');
    await writeFile(join(root, 'miniapp', 'assets', 'app.js.br'), brotliCompressSync(Buffer.from('console.log("сжато")')));

    const app = await buildServer({
      botToken: BOT_TOKEN,
      repository: new InMemoryRepository({ buildings: [{ id: BUILDING_ID, code: 'Д15' }] }),
      defaultBuildingId: BUILDING_ID,
      web: { landing: join(root, 'landing'), miniapp: join(root, 'miniapp') },
      frameAncestors: ["'self'", 'https://max.ru'],
    });

    return { app, clean: () => rm(root, { recursive: true, force: true }) };
  };

  it('корень отдаёт лендинг, а «/app» приложение', async () => {
    const { app, clean } = await site();

    assert.match((await app.inject({ method: 'GET', url: '/' })).body, /Домовой/);
    assert.match((await app.inject({ method: 'GET', url: '/app/' })).body, /Приложение/);

    const short = await app.inject({ method: 'GET', url: '/app' });

    assert.equal(short.statusCode, 308);
    assert.equal(short.headers.location, '/app/');

    await app.close();
    await clean();
  });

  it('ответ API уходит сжатым, если клиент это понимает', async () => {
    const app = await buildServer({
      botToken: BOT_TOKEN,
      repository: new InMemoryRepository({ buildings: [{ id: BUILDING_ID, code: 'Д15' }], apartments: APARTMENTS }),
      defaultBuildingId: BUILDING_ID,
      compress: { threshold: 16 },
    });

    const token = await (async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: { 'x-max-init-data': await initDataFor(1001, 'Мария') },
      });

      return response.json<{ token: string }>().token;
    })();

    const packed = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { ...authed(token), 'accept-encoding': 'gzip' },
    });

    assert.equal(packed.headers['content-encoding'], 'gzip');
    // Приватный ответ разный для разных людей: к сжатию добавляется и сессия.
    assert.match(String(packed.headers.vary), /accept-encoding/);
    assert.match(String(packed.headers.vary), /authorization/);
    assert.equal(JSON.parse(gunzipSync(packed.rawPayload).toString()).displayName, 'Мария');

    const plain = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });

    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.json().displayName, 'Мария');

    await app.close();
  });

  it('сжатую копию отдают тому, кто её понимает, остальным обычный файл', async () => {
    const { app, clean } = await site();

    const compressed = await app.inject({
      method: 'GET',
      url: '/app/assets/app.js',
      headers: { 'accept-encoding': 'br' },
    });

    assert.equal(compressed.headers['content-encoding'], 'br');
    assert.equal(brotliDecompressSync(compressed.rawPayload).toString(), 'console.log("сжато")');

    const plain = await app.inject({ method: 'GET', url: '/app/assets/app.js', headers: { 'accept-encoding': '' } });

    assert.equal(plain.headers['content-encoding'], undefined);
    assert.match(plain.body, /Домовой/);
    assert.match(String(plain.headers['cache-control']), /immutable/);

    await app.close();
    await clean();
  });

  it('промах по адресу сайта показывается страницей, а отказ API остаётся в JSON', async () => {
    const { app, clean } = await site();

    const page = await app.inject({ method: 'GET', url: '/nosuchpage', headers: { accept: 'text/html' } });

    assert.equal(page.statusCode, 404);
    assert.match(page.body, /Страницы нет/);

    const api = await app.inject({ method: 'GET', url: '/api/nosuchroute' });

    assert.equal(api.statusCode, 404);
    assert.equal(api.json().error, 'not_found');

    await app.close();
    await clean();
  });

  it('API остаётся за собой, а рамку разрешают только приложению', async () => {
    const { app, clean } = await site();

    assert.equal((await app.inject({ method: 'GET', url: '/api/me' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);

    const site_ = await app.inject({ method: 'GET', url: '/' });
    const mini = await app.inject({ method: 'GET', url: '/app/' });

    assert.equal(site_.headers['x-frame-options'], 'DENY');
    assert.equal(mini.headers['x-frame-options'], undefined);
    assert.match(String(mini.headers['content-security-policy']), /frame-ancestors 'self' https:\/\/max\.ru/);

    await app.close();
    await clean();
  });
});

describe('вход в приложение', () => {
  it('выдаёт сессию и заводит профиль жильца', async () => {
    const { app, repository } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(1001, 'Мария') },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().displayName, 'Мария');
    assert.notEqual(await repository.findResidentByMaxUserId(1001), undefined);

    await app.close();
  });

  it('повторный вход не создаёт второй профиль', async () => {
    const { app, repository, login } = await setup();

    await login(1001);
    await login(1001);

    const resident = await repository.findResidentByMaxUserId(1001);
    assert.equal(resident?.id, 'id-1', 'профиль тот же');

    await app.close();
  });

  it('без параметров запуска сессию не выдаёт', async () => {
    const { app } = await setup();

    const response = await app.inject({ method: 'POST', url: '/auth/session' });

    assert.equal(response.statusCode, 401);
    await app.close();
  });

  it('health доступен без авторизации', async () => {
    const { app } = await setup();

    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
    await app.close();
  });

  it('защищённый маршрут без токена отвечает 401', async () => {
    const { app } = await setup();

    assert.equal((await app.inject({ method: 'GET', url: '/api/me' })).statusCode, 401);
    await app.close();
  });
});

describe('код с наклейки', () => {
  it('превращается в понятный адрес', async () => {
    const { app, login } = await setup();
    const token = await login(1001);

    const response = await app.inject({
      method: 'GET',
      url: '/api/context/rsr_b1_2_5',
      headers: authed(token),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().target, 'Подъезд 2, стояк 5');
    assert.equal(response.json().audience, 'подъезд 2, стояк 5');

    await app.close();
  });

  it('неизвестный код отвергается', async () => {
    const { app, login } = await setup();
    const token = await login(1001);

    const response = await app.inject({ method: 'GET', url: '/api/context/мусор', headers: authed(token) });

    assert.equal(response.statusCode, 404);
    await app.close();
  });
});

describe('заявки', () => {
  it('создаётся по коду объекта без выбора адреса', async () => {
    const { app, login } = await setup();
    const token = await login(1001);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'Лифт не едет, застряли на 5 этаже', startParam: 'eqp_b1_lift-2' },
    });

    assert.equal(response.statusCode, 201);

    const body = response.json().request;
    assert.equal(response.json().joined, false, 'новая проблема, а не подтверждение чужой');
    assert.equal(body.category, 'elevator', 'категория угадана по тексту');
    assert.equal(body.priority, 'emergency', 'слово «застряли» подняло срочность');
    assert.equal(body.target, 'Оборудование lift-2');
    assert.match(body.number, /^Д15-\d{4}-0001$/);

    await app.close();
  });

  it('номера идут по порядку в пределах дома', async () => {
    const { app, login } = await setup([tenant]);
    const token = await login(1001);

    const create = (description: string) =>
      app.inject({
        method: 'POST',
        url: '/api/requests',
        headers: authed(token),
        payload: { description, startParam: 'apt_apt-1' },
      });

    const first = (await create('течёт кран')).json().request;
    const second = (await create('не закрывается окно')).json().request;

    assert.match(first.number, /0001$/);
    assert.match(second.number, /0002$/);

    await app.close();
  });

  it('без адреса и привязки к квартире заявку не принять', async () => {
    const { app, login } = await setup();
    const token = await login(1001);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'что-то сломалось' },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'target_required');

    await app.close();
  });

  it('пустое описание отсекается схемой', async () => {
    const { app, login } = await setup();
    const token = await login(1001);

    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: '', startParam: 'apt_apt-1' },
    });

    assert.equal(response.statusCode, 400);
    await app.close();
  });

  it('жилец видит свои заявки и не видит чужие', async () => {
    const { app, login } = await setup([tenant]);
    const first = await login(1001, 'Мария');
    const second = await login(2002, 'Иван');

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(first),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });
    const requestId = created.json().request.id;

    const mine = await app.inject({ method: 'GET', url: '/api/requests', headers: authed(first) });
    assert.equal(mine.json().length, 1);

    const alien = await app.inject({ method: 'GET', url: '/api/requests', headers: authed(second) });
    assert.equal(alien.json().length, 0, 'соседские заявки не показываются');

    const direct = await app.inject({ method: 'GET', url: `/api/requests/${requestId}`, headers: authed(second) });
    assert.equal(direct.statusCode, 403);

    await app.close();
  });
});

describe('работа управляющей компании', () => {
  const dispatcher: Resident = {
    id: 'disp-1',
    maxUserId: 5005,
    displayName: 'Диспетчер',
    role: 'dispatcher',
    buildingId: BUILDING_ID,
  };

  it('диспетчер видит очередь дома целиком', async () => {
    const { app, login } = await setup([dispatcher, tenant]);
    const resident = await login(1001);
    const staff = await login(5005);

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });

    const queue = await app.inject({ method: 'GET', url: '/api/requests?scope=queue', headers: authed(staff) });

    assert.equal(queue.json().length, 1);
    await app.close();
  });

  it('заявка проходит путь до выполнения', async () => {
    const { app, login } = await setup([dispatcher, tenant]);
    const resident = await login(1001);
    const staff = await login(5005);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });
    const id = created.json().request.id;

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(staff),
      payload: { to: 'accepted' },
    });
    assert.equal(accepted.json().status, 'accepted');

    const inProgress = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(staff),
      payload: { to: 'in_progress', assigneeId: dispatcher.id },
    });
    assert.equal(inProgress.json().status, 'in_progress');

    const done = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(staff),
      payload: { to: 'done', comment: 'Заменил кран' },
    });
    assert.equal(done.json().status, 'done');
    assert.equal(done.json().history.length, 4);

    await app.close();
  });

  it('жилец пишет по заявке, не меняя её состояния', async () => {
    const { app, login } = await setup([dispatcher, tenant]);
    const resident = await login(1001);
    const staff = await login(5005);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });
    const id = created.json().request.id;

    await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(staff),
      payload: { to: 'accepted' },
    });

    const said = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/comment`,
      headers: authed(resident),
      payload: { text: 'Дома после шести' },
    });

    assert.equal(said.statusCode, 200);
    assert.equal(said.json().status, 'accepted', 'разговор состояния не трогает');

    const last = said.json().history.at(-1);

    assert.equal(last.kind, 'message');
    assert.equal(last.comment, 'Дома после шести');

    await app.close();
  });

  it('по чужой заявке не пишут', async () => {
    const { app, login } = await setup([tenant]);
    const resident = await login(1001);
    const stranger = await login(2002);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/requests/${created.json().request.id}/comment`,
      headers: authed(stranger),
      payload: { text: 'А что случилось?' },
    });

    assert.equal(response.statusCode, 404);

    await app.close();
  });

  it('жилец не может принять свою заявку', async () => {
    const { app, login } = await setup([tenant]);
    const resident = await login(1001);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/requests/${created.json().request.id}/transition`,
      headers: authed(resident),
      payload: { to: 'accepted' },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'role_not_allowed');

    await app.close();
  });

  it('отказ без объяснения не принимается', async () => {
    const { app, login } = await setup([dispatcher, tenant]);
    const resident = await login(1001);
    const staff = await login(5005);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/requests/${created.json().request.id}/transition`,
      headers: authed(staff),
      payload: { to: 'rejected' },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'comment_required');

    await app.close();
  });

  it('интерфейсу подсказываются доступные действия', async () => {
    const { app, login } = await setup([dispatcher, tenant]);
    const resident = await login(1001);
    const staff = await login(5005);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });
    const id = created.json().request.id;

    const forStaff = await app.inject({ method: 'GET', url: `/api/requests/${id}/actions`, headers: authed(staff) });
    assert.deepEqual(forStaff.json().actions, ['accepted', 'rejected']);

    const forResident = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}/actions`,
      headers: authed(resident),
    });
    assert.deepEqual(forResident.json().actions, ['withdrawn']);

    await app.close();
  });
});

describe('заведение дома', () => {
  const manager: Resident = {
    id: 'mgr-setup',
    maxUserId: 7007,
    displayName: 'Нина',
    role: 'manager',
    buildingId: BUILDING_ID,
  };

  const dispatcher: Resident = { ...manager, id: 'disp-setup', maxUserId: 5005, role: 'dispatcher' };

  it('карточка, квартиры и оборудование заводятся через API', async () => {
    const { app, login } = await setup([manager, dispatcher]);
    const boss = authed(await login(7007));

    const card = await app.inject({
      method: 'POST',
      url: '/api/buildings/card',
      headers: boss,
      payload: { code: 'Д15', address: 'ул. Ленина, 15', timeZone: 'Asia/Yekaterinburg' },
    });

    assert.equal(card.json().timeZone, 'Asia/Yekaterinburg');

    const flats = await app.inject({
      method: 'POST',
      url: '/api/import/apartments',
      headers: boss,
      payload: { csv: 'Помещение;Подъезд;Площадь;ХВС\n7;1;54,3;ХВС-007' },
    });

    assert.deepEqual([flats.json().added, flats.json().meters], [1, 1]);

    const equipment = await app.inject({
      method: 'POST',
      url: '/api/import/equipment',
      headers: boss,
      payload: { csv: 'Код;Название;Вид\nlift-9;Лифт, подъезд 1;лифт' },
    });

    assert.equal(equipment.json().added, 1);

    await app.close();
  });

  it('управляющий заводит второй дом и сразу видит его в списке', async () => {
    const { app, login } = await setup([manager, dispatcher]);
    const boss = authed(await login(7007));

    const created = await app.inject({
      method: 'POST',
      url: '/api/buildings',
      headers: boss,
      payload: { code: 'Д17', address: 'ул. Ленина, 17' },
    });

    assert.equal(created.statusCode, 200);
    assert.equal(created.json().address, 'ул. Ленина, 17');

    const list = (await app.inject({ method: 'GET', url: '/api/buildings', headers: boss })).json();

    assert.deepEqual(
      list.map((item: { code: string }) => item.code),
      ['Д15', 'Д17'],
    );

    await app.close();
  });

  it('диспетчер дома не заводит', async () => {
    const { app, login } = await setup([manager, dispatcher]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/buildings',
      headers: authed(await login(5005)),
      payload: { code: 'Д17' },
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });

  it('привязка чата дома видна в карточке и снимается управляющим', async () => {
    const { app, login, repository } = await setup([manager, dispatcher]);
    const boss = authed(await login(7007));

    await repository.saveBuilding({ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', chatId: 777 });

    const [house] = (await app.inject({ method: 'GET', url: '/api/buildings', headers: boss })).json();

    assert.equal(house.chatBound, true);

    const released = await app.inject({ method: 'DELETE', url: '/api/buildings/chat', headers: boss });

    assert.equal(released.json().chatBound, false);
    assert.equal((await repository.findBuilding(BUILDING_ID))?.chatId, undefined);

    await app.close();
  });

  it('диспетчер чат дома не отвязывает', async () => {
    const { app, login, repository } = await setup([manager, dispatcher]);

    await repository.saveBuilding({ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', chatId: 777 });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/buildings/chat',
      headers: authed(await login(5005)),
    });

    assert.equal(response.statusCode, 403);
    assert.equal((await repository.findBuilding(BUILDING_ID))?.chatId, 777);

    await app.close();
  });

  it('диспетчеру заведение дома закрыто', async () => {
    const { app, login } = await setup([manager, dispatcher]);
    const staff = authed(await login(5005));

    for (const url of ['/api/buildings/card', '/api/import/apartments', '/api/import/equipment']) {
      const response = await app.inject({ method: 'POST', url, headers: staff, payload: { csv: 'x', address: 'x' } });

      assert.equal(response.statusCode, 403, url);
    }

    await app.close();
  });

  it('тарифы смотрит смена, а меняет управляющий', async () => {
    const { app, login } = await setup([manager, dispatcher]);

    const seen = await app.inject({ method: 'GET', url: '/api/tariffs', headers: authed(await login(5005)) });

    assert.equal(seen.statusCode, 200);
    assert.equal(seen.json().every((item: { own: boolean }) => item.own === false), true);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/tariffs',
      headers: authed(await login(5005)),
      payload: { kind: 'cold_water', value: 50 },
    });

    assert.equal(denied.statusCode, 403);

    const changed = await app.inject({
      method: 'POST',
      url: '/api/tariffs',
      headers: authed(await login(7007)),
      payload: { kind: 'cold_water', value: 50 },
    });

    assert.equal(changed.json().find((item: { kind: string }) => item.kind === 'cold_water').value, 50);

    const resident = await app.inject({ method: 'GET', url: '/api/tariffs', headers: authed(await login(1001)) });

    assert.equal(resident.statusCode, 403);

    await app.close();
  });

  it('умолчание продукта отличимо от тарифа организации', async () => {
    const { app, login } = await setup([manager, dispatcher]);

    const before = (await app.inject({ method: 'GET', url: '/api/tariffs', headers: authed(await login(5005)) })).json();

    assert.match(
      before.find((item: { kind: string }) => item.kind === 'cold_water').basis,
      /организацией не задан/,
      'умолчание должно быть подписано',
    );

    await app.inject({
      method: 'POST',
      url: '/api/tariffs',
      headers: authed(await login(7007)),
      payload: { kind: 'cold_water', value: 50 },
    });

    const after = (await app.inject({ method: 'GET', url: '/api/tariffs', headers: authed(await login(5005)) })).json();

    assert.equal(after.find((item: { kind: string }) => item.kind === 'cold_water').basis, undefined);

    await app.close();
  });

  it('придуманный вид тарифа не заводится', async () => {
    const { app, login } = await setup([manager]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tariffs',
      headers: authed(await login(7007)),
      payload: { kind: 'выдуманный', value: 50 },
    });

    assert.equal(response.statusCode, 400);

    await app.close();
  });
});

describe('объявления жильцам', () => {
  const manager: Resident = {
    id: 'mgr-1',
    maxUserId: 7007,
    displayName: 'Управляющий',
    role: 'manager',
    buildingId: BUILDING_ID,
  };

  it('адресуются до стояка и считают охват', async () => {
    const { app, login } = await setup([manager]);
    const token = await login(7007);

    const response = await app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: authed(token),
      payload: { title: 'Отключение воды', body: 'Завтра с 9 до 14', entrance: 1, riser: 2 },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().audience, 'подъезд 1, стояк 2');
    assert.equal(response.json().recipients, 1, 'затронута одна квартира, а не весь дом');

    await app.close();
  });

  it('без указания подъезда объявление уходит всему дому', async () => {
    const { app, login } = await setup([manager]);
    const token = await login(7007);

    const response = await app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: authed(token),
      payload: { title: 'Собрание', body: 'В субботу во дворе' },
    });

    assert.equal(response.json().audience, 'весь дом');
    assert.equal(response.json().recipients, APARTMENTS.length);

    await app.close();
  });

  it('жилец объявления не публикует', async () => {
    const { app, login } = await setup();
    const token = await login(1001);

    const response = await app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: authed(token),
      payload: { title: 'Продам гараж', body: 'Недорого' },
    });

    assert.equal(response.statusCode, 403);
    await app.close();
  });
});

describe('рассылка жильцам', () => {
  const dispatcher: Resident = {
    id: 'disp-cast',
    maxUserId: 5005,
    displayName: 'Ольга',
    role: 'dispatcher',
    buildingId: BUILDING_ID,
  };

  const maria: Resident = {
    id: 'res-cast-1',
    maxUserId: 1002,
    displayName: 'Мария',
    role: 'resident',
    apartmentId: 'apt-1',
    buildingId: BUILDING_ID,
  };

  const ivan: Resident = {
    id: 'res-cast-2',
    maxUserId: 1003,
    displayName: 'Иван',
    role: 'resident',
    apartmentId: 'apt-2',
    buildingId: BUILDING_ID,
  };

  const everyone = [dispatcher, maria, ivan];

  it('отдаёт подъезды и стояки, из которых собирают адресат', async () => {
    const { app, login } = await setup(everyone);
    const token = await login(5005);

    const response = await app.inject({ method: 'GET', url: '/api/broadcast/targets', headers: authed(token) });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().flats, APARTMENTS.length);
    assert.deepEqual(
      response.json().entrances.map((entrance: { entrance: number }) => entrance.entrance),
      [1, 2],
    );
    assert.deepEqual(
      response.json().entrances[0].risers.map((riser: { riser: number }) => riser.riser),
      [1, 2],
    );

    await app.close();
  });

  it('охват считается до отправки', async () => {
    const { app, login } = await setup(everyone);
    const token = await login(5005);

    const response = await app.inject({
      method: 'POST',
      url: '/api/broadcast/preview',
      headers: authed(token),
      payload: { kind: 'riser', entrance: 1, riser: 2 },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().audience, 'подъезд 1, стояк 2');
    assert.equal(response.json().recipients, 1);

    await app.close();
  });

  it('отправка возвращает адресат и число ушедших сообщений', async () => {
    const { app, login } = await setup(everyone);
    const token = await login(5005);

    const response = await app.inject({
      method: 'POST',
      url: '/api/broadcast',
      headers: authed(token),
      payload: { kind: 'building', text: 'Завтра отключат воду' },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().audience, 'весь дом');
    assert.equal(response.json().sent, 2);

    await app.close();
  });

  it('неполный адресат до сценария не доходит', async () => {
    const { app, login } = await setup(everyone);
    const token = await login(5005);

    const response = await app.inject({
      method: 'POST',
      url: '/api/broadcast/preview',
      headers: authed(token),
      payload: { kind: 'entrance' },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'target_required');

    await app.close();
  });

  it('жилец рассылку не отправляет', async () => {
    const { app, login } = await setup(everyone);
    const token = await login(1002);

    const response = await app.inject({
      method: 'POST',
      url: '/api/broadcast',
      headers: authed(token),
      payload: { kind: 'building', text: 'Продам гараж' },
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });
});

describe('выгрузка реестра', () => {
  const dispatcher: Resident = {
    id: 'disp-csv',
    maxUserId: 5005,
    displayName: 'Ольга',
    role: 'dispatcher',
    buildingId: BUILDING_ID,
  };

  it('отдаётся файлом с именем и типом', async () => {
    const { app, login } = await setup([dispatcher, tenant]);
    const residentToken = await login(1001);

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(residentToken),
      payload: { description: 'Течёт кран', startParam: 'apt_apt-1' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/report/requests.csv?days=30',
      headers: authed(await login(5005)),
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /text\/csv/);
    assert.match(response.headers['content-disposition'] as string, /filename\*=UTF-8''/);
    assert.match(response.body, /Течёт кран/);

    await app.close();
  });

  it('телефон без подписи платформы не принимается', async () => {
    const { app, login } = await setup([dispatcher]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/contact',
      headers: authed(await login(1001)),
      payload: { phone: '+79991234567' },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'contact_not_verified');

    await app.close();
  });

  it('протокол собрания отдаётся файлом', async () => {
    const { app, login } = await setup([dispatcher]);
    const staff = authed(await login(5005));

    const poll = await app.inject({
      method: 'POST',
      url: '/api/polls',
      headers: staff,
      payload: { kind: 'simple', title: 'Шлагбаум', question: 'Установить шлагбаум', days: 1 },
    });

    const id = poll.json().id;

    const early = await app.inject({ method: 'GET', url: `/api/polls/${id}/protocol.txt`, headers: staff });

    assert.equal(early.statusCode, 409);

    await app.close();
  });

  it('подписи соседей превращают предложение в собрание', async () => {
    const maria: Resident = {
      id: 'res-maria',
      maxUserId: 1001,
      displayName: 'Мария',
      role: 'resident',
      apartmentId: 'apt-1',
      buildingId: BUILDING_ID,
    };
    const petr: Resident = { ...maria, id: 'res-petr', maxUserId: 1002, displayName: 'Пётр', apartmentId: 'apt-2' };
    const { app, login } = await setup([dispatcher, maria, petr]);

    const started = await app.inject({
      method: 'POST',
      url: '/api/initiatives',
      headers: authed(await login(1001)),
      payload: { title: 'Шлагбаум во двор', question: 'Поставить шлагбаум на въезд' },
    });

    assert.equal(started.statusCode, 201);
    assert.equal(started.json().signatures, 1);
    assert.equal(started.json().enough, true);
    assert.equal(started.json().mine, true);

    const supported = await app.inject({
      method: 'POST',
      url: `/api/initiatives/${started.json().id}/support`,
      headers: authed(await login(1002)),
    });

    assert.equal(supported.json().signatures, 2);
    assert.equal(supported.json().author, false);

    const meeting = await app.inject({
      method: 'POST',
      url: `/api/initiatives/${started.json().id}/meeting`,
      headers: authed(await login(5005)),
      payload: { days: 14, kind: 'qualified' },
    });

    assert.equal(meeting.statusCode, 201);
    assert.equal(meeting.json().title, 'Шлагбаум во двор');
    assert.equal(meeting.json().kind, 'qualified');

    const listed = await app.inject({ method: 'GET', url: '/api/initiatives', headers: authed(await login(1001)) });

    assert.equal(listed.json()[0].pollId, meeting.json().id);

    await app.close();
  });

  it('старшего по подъезду ставят на голосование, а не назначают', async () => {
    const maria: Resident = {
      id: 'res-maria',
      maxUserId: 1001,
      displayName: 'Мария',
      role: 'resident',
      apartmentId: 'apt-1',
      buildingId: BUILDING_ID,
    };
    const { app, login } = await setup([dispatcher, maria]);

    const started = await app.inject({
      method: 'POST',
      url: '/api/polls/elder',
      headers: authed(await login(5005)),
      payload: { candidateId: maria.id, days: 14 },
    });

    assert.equal(started.statusCode, 201);
    assert.match(started.json().title, /Старший по подъезду 1/);

    const profile = await app.inject({ method: 'GET', url: '/api/me', headers: authed(await login(1001)) });

    assert.equal(profile.json().elder, undefined);

    const byResident = await app.inject({
      method: 'POST',
      url: '/api/polls/elder',
      headers: authed(await login(1001)),
      payload: { candidateId: maria.id, days: 14 },
    });

    assert.equal(byResident.statusCode, 403);

    await app.close();
  });

  it('собрание по чужому предложению жилец не созывает', async () => {
    const maria: Resident = {
      id: 'res-maria',
      maxUserId: 1001,
      displayName: 'Мария',
      role: 'resident',
      apartmentId: 'apt-1',
      buildingId: BUILDING_ID,
    };
    const { app, login } = await setup([dispatcher, maria]);

    const started = await app.inject({
      method: 'POST',
      url: '/api/initiatives',
      headers: authed(await login(1001)),
      payload: { title: 'Шлагбаум во двор', question: 'Поставить шлагбаум на въезд' },
    });

    const meeting = await app.inject({
      method: 'POST',
      url: `/api/initiatives/${started.json().id}/meeting`,
      headers: authed(await login(1001)),
      payload: { days: 14 },
    });

    assert.equal(meeting.statusCode, 403);

    await app.close();
  });

  it('показания за месяц отдаются отдельным файлом', async () => {
    const { app, login } = await setup([dispatcher]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/export/readings.csv',
      headers: authed(await login(5005)),
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /text\/csv/);
    assert.match(response.headers['content-disposition'] as string, /filename\*=UTF-8''/);
    assert.match(response.body, /Прибор учёта;Вид ресурса/);

    await app.close();
  });

  it('реестр выгружается книгой Excel, а не только текстом', async () => {
    const { app, login } = await setup([dispatcher, tenant]);
    const residentToken = await login(1001);

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(residentToken),
      payload: { description: 'Течёт кран', startParam: 'apt_apt-1' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/report/requests.xlsx?days=30',
      headers: authed(await login(5005)),
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /spreadsheetml\.sheet/);
    assert.match(response.headers['content-disposition'] as string, /filename\*=UTF-8''.+\.xlsx/);

    const book = response.rawPayload;

    assert.equal(book.subarray(0, 4).toString('binary'), 'PK\u0003\u0004');

    const sheet = unpack(book, 'xl/worksheets/sheet1.xml');

    assert.match(sheet, /Течёт кран/);
    assert.match(sheet, /Номер|№/);

    await app.close();
  });

  it('жильцу выгрузка закрыта', async () => {
    const { app, login } = await setup([dispatcher]);

    for (const url of ['/api/report/requests.csv', '/api/export/readings.csv', '/api/report/requests.xlsx']) {
      const response = await app.inject({ method: 'GET', url, headers: authed(await login(1001)) });

      assert.equal(response.statusCode, 403, url);
    }

    await app.close();
  });
});

describe('привязка жильцов', () => {
  const dispatcher: Resident = {
    id: 'disp-1',
    maxUserId: 5005,
    displayName: 'Ольга',
    role: 'dispatcher',
    buildingId: BUILDING_ID,
  };

  it('жилец привязывается по коду из квитанции сам', async () => {
    const { app, login } = await setup();
    const token = await login(1001);

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/apartment',
      headers: authed(token),
      payload: { code: CODES.second },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().number, 2);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });

    assert.equal(me.json().apartmentId, 'apt-2');

    await app.close();
  });

  it('заявку по квартире открывает привязка, а не сам код с наклейки', async () => {
    const { app, login } = await setup();
    const token = await login(1001);

    const create = () =>
      app.inject({
        method: 'POST',
        url: '/api/requests',
        headers: authed(token),
        payload: { description: 'Течёт кран', startParam: 'apt_apt-1' },
      });

    const before = await create();

    assert.equal(before.statusCode, 403, 'непривязанный жилец заявку по квартире не заводит');
    assert.equal(before.json().error, 'forbidden');

    await app.inject({
      method: 'POST',
      url: '/api/me/apartment',
      headers: authed(token),
      payload: { code: CODES.first },
    });

    const after = await create();

    assert.equal(after.statusCode, 201, after.body);
    assert.equal(after.json().request.target, 'Квартира 1');

    await app.close();
  });

  it('две квартиры: список отдаётся с адресами, выбор переключает текущую', async () => {
    const { app, login } = await setup();
    const token = await login(1001);

    for (const code of [CODES.first, CODES.second]) {
      await app.inject({ method: 'POST', url: '/api/me/apartment', headers: authed(token), payload: { code } });
    }

    const list = (await app.inject({ method: 'GET', url: '/api/me/apartments', headers: authed(token) })).json();

    assert.deepEqual(
      list.map((item: { number: number; current: boolean }) => [item.number, item.current]),
      [
        [1, false],
        [2, true],
      ],
    );

    const switched = await app.inject({
      method: 'POST',
      url: '/api/me/apartment/use',
      headers: authed(token),
      payload: { apartmentId: 'apt-1' },
    });

    assert.equal(switched.statusCode, 200);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });

    assert.equal(me.json().apartmentId, 'apt-1');

    await app.close();
  });

  it('смена освобождает названную квартиру, а не текущую', async () => {
    const { app, login, repository } = await setup([
      { id: 'mgr-1', maxUserId: 7007, displayName: 'Управляющий', role: 'manager', buildingId: BUILDING_ID },
    ]);
    const token = await login(1001);

    for (const code of [CODES.first, CODES.second]) {
      await app.inject({ method: 'POST', url: '/api/me/apartment', headers: authed(token), payload: { code } });
    }

    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) })).json();
    const manager = await login(7007);

    const response = await app.inject({
      method: 'POST',
      url: `/api/residents/${me.id}/unbind`,
      headers: authed(manager),
      payload: { apartmentId: 'apt-1' },
    });

    assert.equal(response.statusCode, 200);

    const saved = await repository.findResident(me.id);

    assert.deepEqual(saved?.apartmentIds, ['apt-2']);
    assert.equal(saved?.apartmentId, 'apt-2', 'текущая квартира осталась прежней');

    await app.close();
  });

  it('чужую квартиру выбрать нельзя', async () => {
    const { app, login } = await setup();
    const token = await login(1001);

    await app.inject({
      method: 'POST',
      url: '/api/me/apartment',
      headers: authed(token),
      payload: { code: CODES.first },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/apartment/use',
      headers: authed(token),
      payload: { apartmentId: 'apt-2' },
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });

  it('непривязанный жилец виден управляющей компании', async () => {
    const { app, login } = await setup([dispatcher]);

    await login(1001, 'Мария');
    const staffToken = await login(5005);

    const response = await app.inject({
      method: 'GET',
      url: '/api/residents/unbound',
      headers: authed(staffToken),
    });

    assert.deepEqual(
      response.json().map((item: { displayName: string }) => item.displayName),
      ['Мария'],
    );

    await app.close();
  });

  it('сотрудник привязывает жильца, и тот пропадает из списка', async () => {
    const { app, login } = await setup([dispatcher]);

    await login(1001, 'Мария');
    const staffToken = await login(5005);

    const [unbound] = (await app.inject({
      method: 'GET',
      url: '/api/residents/unbound',
      headers: authed(staffToken),
    })).json<{ id: string }[]>();

    const bound = await app.inject({
      method: 'POST',
      url: `/api/residents/${unbound!.id}/apartment`,
      headers: authed(staffToken),
      payload: { apartmentId: 'apt-3' },
    });

    assert.equal(bound.statusCode, 200);
    assert.equal(bound.json().number, 20);

    const after = await app.inject({
      method: 'GET',
      url: '/api/residents/unbound',
      headers: authed(staffToken),
    });

    assert.deepEqual(after.json(), []);

    await app.close();
  });

  it('жилец чужие привязки не раздаёт', async () => {
    const { app, login } = await setup([dispatcher]);

    const token = await login(1001, 'Мария');
    await login(1002, 'Павел');

    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/residents/unbound', headers: authed(token) })).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/apartments', headers: authed(token) })).statusCode,
      403,
    );

    await app.close();
  });

  it('несуществующий житель, не повод выходить из приложения', async () => {
    const { app, login } = await setup([dispatcher]);
    const staffToken = await login(5005);

    const response = await app.inject({
      method: 'POST',
      url: '/api/residents/нет-такого/apartment',
      headers: authed(staffToken),
      payload: { apartmentId: 'apt-1' },
    });

    assert.equal(response.statusCode, 404);

    await app.close();
  });

  it('квартиры дома отдаются сотруднику для выбора', async () => {
    const { app, login } = await setup([dispatcher]);
    const staffToken = await login(5005);

    const response = await app.inject({ method: 'GET', url: '/api/apartments', headers: authed(staffToken) });

    assert.deepEqual(
      response.json().map((item: { number: number }) => item.number),
      [1, 2, 20],
      'по возрастанию номера',
    );

    await app.close();
  });
});

describe('несколько домов у одной компании', () => {
  const SECOND = 'b2';

  const dispatcher: Resident = {
    id: 'disp-houses',
    maxUserId: 5005,
    displayName: 'Ольга',
    role: 'dispatcher',
    buildingId: BUILDING_ID,
  };

  const neighbourHouse: Resident = {
    id: 'res-second',
    maxUserId: 1002,
    displayName: 'Жилец второго дома',
    role: 'resident',
    apartmentId: 'apt-b2',
    buildingId: SECOND,
  };

  /** Две дома одной компании: у сотрудника есть выбор, у жильца, нет. */
  const twoBuildings = async (residents: Resident[] = [dispatcher, neighbourHouse]): Promise<Harness> => {
    const repository = new InMemoryRepository({
      buildings: [
        { id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', companyId: 'ук-первая' },
        { id: SECOND, code: 'Д17', address: 'ул. Ленина, 17', companyId: 'ук-первая' },
      ],
      apartments: [
        ...APARTMENTS,
        { id: 'apt-b2', buildingId: SECOND, number: 7, entrance: 1, riser: 1, area: 40 },
      ],
      residents,
    });

    let counter = 0;
    const app = await buildServer({
      botToken: BOT_TOKEN,
      repository,
      defaultBuildingId: BUILDING_ID,
      createId: () => `id-${++counter}`,
      hub: createMockHub({
        now: () => new Date('2026-09-22T10:00:00Z'),
        devices: [
          { id: 'lock-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1' },
          { id: 'lock-2', buildingId: SECOND, kind: 'barrier', title: 'Шлагбаум Д17' },
        ],
      }),
    });

    const login = async (userId: number, name?: string): Promise<string> => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: { 'x-max-init-data': await initDataFor(userId, name) },
      });

      assert.equal(response.statusCode, 200, `вход не удался: ${response.body}`);
      return response.json<{ token: string }>().token;
    };

    return { app, repository, login };
  };

  it('сотруднику отдают все дома и отмечают его собственный', async () => {
    const harness = await twoBuildings();
    const staff = await harness.login(5005);

    const response = await harness.app.inject({ method: 'GET', url: '/api/buildings', headers: authed(staff) });

    assert.deepEqual(
      response.json().map((building: { code: string; current: boolean }) => [building.code, building.current]),
      [
        ['Д15', true],
        ['Д17', false],
      ],
    );

    await harness.app.close();
  });

  it('жильцу отдают только его дом', async () => {
    const harness = await twoBuildings();
    const resident = await harness.login(1002);

    const response = await harness.app.inject({ method: 'GET', url: '/api/buildings', headers: authed(resident) });

    assert.deepEqual(
      response.json().map((building: { id: string }) => building.id),
      [SECOND],
    );

    await harness.app.close();
  });

  it('сотрудник смотрит очередь другого дома', async () => {
    const harness = await twoBuildings();
    const staff = await harness.login(5005);
    const resident = await harness.login(1002);

    await harness.app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'течёт кран' },
    });

    const own = await harness.app.inject({
      method: 'GET',
      url: '/api/requests?scope=queue',
      headers: authed(staff),
    });

    assert.deepEqual(own.json(), [], 'в своём доме заявок нет');

    const other = await harness.app.inject({
      method: 'GET',
      url: `/api/requests?scope=queue&buildingId=${SECOND}`,
      headers: authed(staff),
    });

    assert.equal(other.json().length, 1);

    await harness.app.close();
  });

  it('жилец чужой дом подставить не может', async () => {
    const harness = await twoBuildings();
    const resident = await harness.login(1002);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/requests?scope=mine&buildingId=${BUILDING_ID}`,
      headers: authed(resident),
    });

    assert.equal(response.statusCode, 403);

    await harness.app.close();
  });

  it('несуществующий дом, 404, а не пустая очередь', async () => {
    const harness = await twoBuildings();
    const staff = await harness.login(5005);

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/requests?scope=queue&buildingId=нет-такого',
      headers: authed(staff),
    });

    assert.equal(response.statusCode, 404);

    await harness.app.close();
  });

  it('переключение дома доходит до оборудования, а не только до заявок', async () => {
    const harness = await twoBuildings();
    const staff = await harness.login(5005);

    const own = await harness.app.inject({ method: 'GET', url: '/api/devices', headers: authed(staff) });

    assert.deepEqual(
      own.json().map((device: { title: string }) => device.title),
      ['Домофон, подъезд 1'],
    );

    const other = await harness.app.inject({
      method: 'GET',
      url: `/api/devices?buildingId=${SECOND}`,
      headers: authed(staff),
    });

    assert.deepEqual(
      other.json().map((device: { title: string }) => device.title),
      ['Шлагбаум Д17'],
      'открывать дверь чужого дома управляющий может только выбрав этот дом',
    );

    await harness.app.close();
  });

  it('собрание объявляется в выбранном доме и там же читается', async () => {
    const harness = await twoBuildings();
    const staff = await harness.login(5005);

    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/polls?buildingId=${SECOND}`,
      headers: authed(staff),
      payload: { kind: 'simple', title: 'Шлагбаум', question: 'Ставим?', days: 7 },
    });

    assert.equal(created.statusCode, 201, created.body);

    const own = await harness.app.inject({ method: 'GET', url: '/api/polls', headers: authed(staff) });

    assert.deepEqual(own.json(), [], 'в своём доме собраний не объявляли');

    const other = await harness.app.inject({
      method: 'GET',
      url: `/api/polls?buildingId=${SECOND}`,
      headers: authed(staff),
    });

    assert.equal(other.json().length, 1);

    await harness.app.close();
  });

  it('сводка считается по выбранному дому', async () => {
    const harness = await twoBuildings();
    const staff = await harness.login(5005);

    const report = await harness.app.inject({
      method: 'GET',
      url: `/api/report?buildingId=${SECOND}`,
      headers: authed(staff),
    });

    assert.equal(report.json().buildingId, SECOND);

    await harness.app.close();
  });
});

describe('журнал действий', () => {
  const dispatcher: Resident = {
    id: 'disp-audit',
    maxUserId: 5005,
    displayName: 'Ольга',
    role: 'dispatcher',
    buildingId: BUILDING_ID,
  };

  const manager: Resident = {
    id: 'mgr-audit',
    maxUserId: 7007,
    displayName: 'Нина',
    role: 'manager',
    buildingId: BUILDING_ID,
  };

  it('управляющий видит, кто что сделал', async () => {
    const { app, login } = await setup([dispatcher, manager, tenant]);
    const resident = await login(1001);
    const staff = await login(5005);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });

    await app.inject({
      method: 'POST',
      url: `/api/requests/${created.json().request.id}/transition`,
      headers: authed(staff),
      payload: { to: 'rejected', comment: 'Зона ответственности собственника' },
    });

    const audit = await app.inject({ method: 'GET', url: '/api/audit', headers: authed(await login(7007)) });
    const [entry] = audit.json();

    assert.equal(audit.statusCode, 200);
    assert.equal(entry.action, 'request_rejected');
    assert.equal(entry.actionTitle, 'Отклонена заявка');
    assert.equal(entry.actorName, 'Ольга');
    assert.equal(entry.details, 'Зона ответственности собственника');

    await app.close();
  });

  it('смене журнал закрыт', async () => {
    const { app, login } = await setup([dispatcher, manager]);

    for (const maxUserId of [5005, 1001]) {
      const response = await app.inject({ method: 'GET', url: '/api/audit', headers: authed(await login(maxUserId)) });

      assert.equal(response.statusCode, 403, String(maxUserId));
    }

    await app.close();
  });
});

describe('оценка работы', () => {
  const dispatcher: Resident = {
    id: 'disp-rating',
    maxUserId: 5005,
    displayName: 'Ольга',
    role: 'dispatcher',
    buildingId: BUILDING_ID,
  };

  /** Доводит заявку до «выполнено»: оценивают только сделанную работу. */
  const upToDone = async (harness: Harness): Promise<{ id: string; resident: string }> => {
    const resident = await harness.login(1001, 'Мария');
    const staff = await harness.login(5005);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(resident),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });
    const id = created.json().request.id;

    for (const to of ['accepted', 'in_progress', 'done']) {
      await harness.app.inject({
        method: 'POST',
        url: `/api/requests/${id}/transition`,
        headers: authed(staff),
        payload: {
          to,
          ...(to === 'in_progress' ? { assigneeId: dispatcher.id } : {}),
          ...(to === 'done' ? { comment: 'Заменил кран' } : {}),
        },
      });
    }

    return { id, resident };
  };

  it('жилец принимает работу с оценкой, и та остаётся в заявке', async () => {
    const harness = await setup([dispatcher, tenant]);
    const { id, resident } = await upToDone(harness);

    const confirmed = await harness.app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(resident),
      payload: { to: 'confirmed', rating: 5 },
    });

    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.json().rating, 5);

    await harness.app.close();
  });

  it('принять работу можно и без оценки', async () => {
    const harness = await setup([dispatcher, tenant]);
    const { id, resident } = await upToDone(harness);

    const confirmed = await harness.app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(resident),
      payload: { to: 'confirmed' },
    });

    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.json().rating, undefined);

    await harness.app.close();
  });

  it('оценка вне шкалы не принимается', async () => {
    const harness = await setup([dispatcher, tenant]);
    const { id, resident } = await upToDone(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(resident),
      payload: { to: 'confirmed', rating: 9 },
    });

    assert.equal(response.statusCode, 400);

    await harness.app.close();
  });

  it('оценка попадает в сводку вместе с числом оценивших', async () => {
    const harness = await setup([dispatcher, tenant]);
    const { id, resident } = await upToDone(harness);
    const staff = await harness.login(5005);

    await harness.app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(resident),
      payload: { to: 'confirmed', rating: 4 },
    });

    const report = await harness.app.inject({ method: 'GET', url: '/api/report', headers: authed(staff) });

    assert.equal(report.json().period.rated, 1);
    assert.equal(report.json().period.averageRating, 4);

    await harness.app.close();
  });
});

describe('снимки к заявке', () => {
  const dispatcher: Resident = {
    id: 'disp-photo',
    maxUserId: 5005,
    displayName: 'Ольга',
    role: 'dispatcher',
    buildingId: BUILDING_ID,
  };

  const PIXEL = Buffer.alloc(64, 1).toString('base64');

  const upload = async (app: FastifyInstance, token: string, data = PIXEL, contentType = 'image/jpeg') =>
    app.inject({
      method: 'POST',
      url: '/api/files',
      headers: authed(token),
      payload: { contentType, data },
    });

  it('снимок отправляется и возвращается вложением', async () => {
    const { app, login } = await setup();
    const token = await login(1001, 'Мария');

    const response = await upload(app, token);

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().kind, 'photo');
    assert.match(response.json().token, /^file:/);

    await app.close();
  });

  it('снимок приезжает обратно теми же байтами и с тем же типом', async () => {
    const { app, login } = await setup();
    const token = await login(1001, 'Мария');

    const uploaded = await upload(app, token);
    const id = uploaded.json().token.slice('file:'.length);

    const response = await app.inject({ method: 'GET', url: `/api/files/${id}`, headers: authed(token) });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /^image\/jpeg/);
    assert.deepEqual(response.rawPayload, Buffer.from(PIXEL, 'base64'));

    await app.close();
  });

  it('снимок попадает в заявку и виден диспетчеру', async () => {
    const { app, login } = await setup([dispatcher, tenant]);
    const token = await login(1001, 'Мария');
    const staffToken = await login(5005);

    const attachment = (await upload(app, token)).json();

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'Течёт кран на кухне', startParam: 'apt_apt-1', attachments: [attachment] },
    });

    const queue = await app.inject({ method: 'GET', url: '/api/requests?scope=queue', headers: authed(staffToken) });

    assert.deepEqual(queue.json()[0].attachments, [attachment]);

    const id = attachment.token.slice('file:'.length);
    const seen = await app.inject({ method: 'GET', url: `/api/files/${id}`, headers: authed(staffToken) });

    assert.equal(seen.statusCode, 200);

    await app.close();
  });

  it('снимок без подписи уходит сообщением по заявке', async () => {
    const { app, login } = await setup([dispatcher, tenant]);
    const token = await login(1001, 'Мария');
    const attachment = (await upload(app, token)).json();

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'Течёт кран на кухне', startParam: 'apt_apt-1' },
    });

    const id = created.json().request.id;

    const commented = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/comment`,
      headers: authed(token),
      payload: { text: '', attachments: [attachment] },
    });

    assert.equal(commented.statusCode, 200, commented.body);

    const empty = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/comment`,
      headers: authed(token),
      payload: { text: '' },
    });

    assert.equal(empty.statusCode, 400, 'совсем пустое сообщение не принимается');

    await app.close();
  });

  it('чужой снимок жильцу не отдают', async () => {
    const { app, login } = await setup();
    const token = await login(1001, 'Мария');
    const neighbour = await login(1002, 'Пётр');

    const id = (await upload(app, token)).json().token.slice('file:'.length);

    const response = await app.inject({ method: 'GET', url: `/api/files/${id}`, headers: authed(neighbour) });

    assert.equal(response.statusCode, 403);

    await app.close();
  });

  it('без сессии за снимком не пускают', async () => {
    const { app, login } = await setup();
    const token = await login(1001, 'Мария');

    const id = (await upload(app, token)).json().token.slice('file:'.length);

    assert.equal((await app.inject({ method: 'GET', url: `/api/files/${id}` })).statusCode, 401);

    await app.close();
  });

  it('не изображение отклоняют с объяснением', async () => {
    const { app, login } = await setup();
    const token = await login(1001, 'Мария');

    const response = await upload(app, token, PIXEL, 'application/pdf');

    assert.equal(response.statusCode, 400);
    assert.match(response.json().message, /фотографию/);

    await app.close();
  });

  it('мастер отчитывается снимком, и тот виден в истории', async () => {
    const { app, login } = await setup([dispatcher, tenant]);
    const token = await login(1001, 'Мария');
    const staffToken = await login(5005);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'течёт кран', startParam: 'apt_apt-1' },
    });
    const id = created.json().request.id;

    for (const to of ['accepted', 'in_progress']) {
      await app.inject({
        method: 'POST',
        url: `/api/requests/${id}/transition`,
        headers: authed(staffToken),
        payload: { to, ...(to === 'in_progress' ? { assigneeId: dispatcher.id } : {}) },
      });
    }

    const attachment = (await upload(app, staffToken)).json();

    const done = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(staffToken),
      payload: { to: 'done', comment: 'Заменил кран', attachments: [attachment] },
    });

    assert.equal(done.statusCode, 200);

    const history = done.json().history;

    assert.deepEqual(history.at(-1).attachments, [attachment]);
    assert.deepEqual(done.json().attachments, []);
    assert.equal(history[0].attachments, undefined);

    await app.close();
  });

  it('несуществующий снимок, 404', async () => {
    const { app, login } = await setup();
    const token = await login(1001, 'Мария');

    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/files/нет-такого', headers: authed(token) })).statusCode,
      404,
    );

    await app.close();
  });
});

describe('что в доме сейчас', () => {
  const maria: Resident = {
    id: 'res-maria',
    maxUserId: 1001,
    displayName: 'Мария',
    role: 'resident',
    apartmentId: 'apt-1',
    buildingId: BUILDING_ID,
  };

  const petr: Resident = {
    id: 'res-petr',
    maxUserId: 1002,
    displayName: 'Пётр',
    role: 'resident',
    apartmentId: 'apt-2',
    buildingId: BUILDING_ID,
  };

  it('отдаёт аварию по дому с адресом и сроком', async () => {
    const { app, login } = await setup([maria, petr]);
    const author = await login(1002);

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(author),
      payload: { description: 'Застряли в лифте', startParam: 'ent_b1_1' },
    });

    const response = await app.inject({ method: 'GET', url: '/api/now', headers: authed(await login(1001)) });
    const [incident] = response.json().incidents;

    assert.equal(response.statusCode, 200);
    assert.match(incident.title, /лифт/i);
    assert.equal(incident.target, 'Подъезд 1');
    assert.ok(incident.resolutionDueAt, 'без срока строка ничего не обещает');

    await app.close();
  });

  it('свою заявку в сводку не кладёт: она и так в списке', async () => {
    const { app, login } = await setup([maria]);
    const token = await login(1001);

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'Застряли в лифте', startParam: 'ent_b1_1' },
    });

    const response = await app.inject({ method: 'GET', url: '/api/now', headers: authed(token) });

    assert.deepEqual(response.json().incidents, []);

    await app.close();
  });
});

describe('план дома', () => {
  const dispatcher: Resident = {
    id: 'disp-plan',
    maxUserId: 2001,
    displayName: 'Ольга',
    role: 'dispatcher',
    buildingId: BUILDING_ID,
  };

  const ivan: Resident = {
    id: 'res-ivan',
    maxUserId: 1002,
    displayName: 'Иван',
    role: 'resident',
    apartmentId: 'apt-2',
    buildingId: BUILDING_ID,
  };

  it('раскладывает дом по подъездам и подсвечивает адрес заявки', async () => {
    const { app, login } = await setup([dispatcher, ivan]);

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(await login(1002)),
      payload: { description: 'Течёт кран на кухне' },
    });

    const response = await app.inject({ method: 'GET', url: '/api/plan', headers: authed(await login(2001)) });
    const plan = response.json();
    const flats = plan.entrances.flatMap((entrance: { risers: { flats: unknown[] }[] }) =>
      entrance.risers.flatMap((riser) => riser.flats),
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      flats.find((item: { number: number }) => item.number === 2),
      { number: 2, state: 'open', requestId: 'id-1' },
    );

    await app.close();
  });

  it('жильцу план дома недоступен', async () => {
    const { app, login } = await setup([ivan]);

    const response = await app.inject({ method: 'GET', url: '/api/plan', headers: authed(await login(1002)) });

    assert.equal(response.statusCode, 403);

    await app.close();
  });
});

describe('здоровье оборудования', () => {
  const dispatcher: Resident = {
    id: 'disp-1',
    maxUserId: 2001,
    displayName: 'Ольга',
    role: 'dispatcher',
    buildingId: BUILDING_ID,
  };

  const maria: Resident = {
    id: 'res-maria',
    maxUserId: 1001,
    displayName: 'Мария',
    role: 'resident',
    apartmentId: 'apt-1',
    buildingId: BUILDING_ID,
  };

  it('считает поломки по оборудованию дома', async () => {
    const { app, login, repository } = await setup([dispatcher, maria]);

    await repository.saveEquipment({ code: 'lift-1', buildingId: BUILDING_ID, title: 'Лифт, подъезд 1' });

    await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(await login(1001)),
      payload: { description: 'Застряли в лифте', startParam: 'eqp_b1_lift-1' },
    });

    const response = await app.inject({ method: 'GET', url: '/api/equipment', headers: authed(await login(2001)) });
    const [lift] = response.json();

    assert.equal(lift.title, 'Лифт, подъезд 1');
    assert.equal(lift.failures, 1);
    assert.equal(lift.broken, true);
    assert.equal(lift.averageDays, undefined);

    await app.close();
  });

  it('жильцу обслуживание дома недоступно', async () => {
    const { app, login } = await setup([maria]);

    const response = await app.inject({ method: 'GET', url: '/api/equipment', headers: authed(await login(1001)) });

    assert.equal(response.statusCode, 403);

    await app.close();
  });
});

describe('совет по аварии', () => {
  it('приходит с открытой аварийной заявкой и исчезает после закрытия', async () => {
    const { app, login } = await setup([tenant]);
    const token = await login(1001);

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'Прорыв трубы в ванной, заливает соседей', startParam: 'apt_apt-1' },
    });

    assert.equal(created.statusCode, 201, created.body);

    const { id } = created.json().request;
    const open = await app.inject({ method: 'GET', url: `/api/requests/${id}`, headers: authed(token) });

    assert.equal(open.json().priority, 'emergency');
    assert.match(open.json().hint, /перекройте воду/i);

    await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/transition`,
      headers: authed(token),
      payload: { to: 'withdrawn' },
    });

    const closed = await app.inject({ method: 'GET', url: `/api/requests/${id}`, headers: authed(token) });

    assert.equal(closed.json().hint, undefined, 'закрытой заявке совет не нужен');

    await app.close();
  });
});
