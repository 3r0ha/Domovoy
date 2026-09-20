import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signInitData } from '@maxkit/bridge';
import type { FastifyInstance } from 'fastify';

import { InMemoryRepository, createMockHub, type Device, type MachineTranslator, type Resident } from '@domovoy/app';
import { encodeTarget } from '@domovoy/domain';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'machine-bot-token';
const BUILDING_ID = 'b1';
const JOHN_ID = 7101;
const MARIA_ID = 7102;
const STAFF_ID = 7103;

/** Жилец с английским языком: объявления дома доходят до него в переводе. */
const john: Resident = {
  id: 'res-john',
  maxUserId: JOHN_ID,
  displayName: 'John',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
  language: 'en',
};

const maria: Resident = {
  id: 'res-maria',
  maxUserId: MARIA_ID,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
  language: 'ru',
};

const manager: Resident = {
  id: 'res-manager',
  maxUserId: STAFF_ID,
  displayName: 'Управляющий',
  role: 'manager',
  buildingId: BUILDING_ID,
  language: 'en',
};

interface Service {
  batches: string[][];
  machine: MachineTranslator;
}

const service = (answer: (text: string) => string | undefined = (text) => `EN: ${text}`): Service => {
  const batches: string[][] = [];

  return {
    batches,
    machine: {
      async translate(texts) {
        batches.push([...texts]);

        return texts.map((text) => answer(text));
      },
    },
  };
};

interface Harness {
  app: FastifyInstance;
  login: (userId: number, name: string) => Promise<string>;
}

/** Оборудование дома: его названия ведёт компания по-русски. */
const DEVICES: Device[] = [
  { id: 'intercom-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 },
];

const LIFT = { buildingId: BUILDING_ID, code: 'LIFT1', title: 'Лифт, подъезд 1' };

const setup = async (machine?: MachineTranslator): Promise<Harness> => {
  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, code: 'ACEFHK34', number: 1, entrance: 1, riser: 1, area: 50 },
        { id: 'apt-2', buildingId: BUILDING_ID, code: 'ACEFHK35', number: 2, entrance: 1, riser: 1, area: 50 },
      ],
      residents: [john, maria, manager],
      equipment: [LIFT],
    }),
    defaultBuildingId: BUILDING_ID,
    hub: createMockHub({ devices: DEVICES, now: () => new Date(), createCode: () => '123456' }),
    ...(machine ? { machine } : {}),
  });

  const login = async (userId: number, name: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: {
        'x-max-init-data': await signInitData(
          {
            auth_date: Math.floor(Date.now() / 1000),
            query_id: `q-${userId}`,
            user: JSON.stringify({ id: userId, first_name: name }),
          },
          BOT_TOKEN,
        ),
      },
    });

    assert.equal(response.statusCode, 200, `вход не удался: ${response.body}`);

    return response.json<{ token: string }>().token;
  };

  return { app, login };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

const publish = async (app: FastifyInstance, token: string): Promise<void> => {
  const posted = await app.inject({
    method: 'POST',
    url: '/api/announcements',
    headers: authed(token),
    payload: { title: 'Отключение горячей воды', body: 'С понедельника по среду идут плановые работы' },
  });

  assert.equal(posted.statusCode, 201, posted.body);
};

const announcements = async (app: FastifyInstance, token: string) => {
  const list = await app.inject({ method: 'GET', url: '/api/announcements', headers: authed(token) });

  assert.equal(list.statusCode, 200, list.body);

  return list.json<{ title: string; body: string; machineTranslated?: boolean }[]>();
};

describe('объявления дома в машинном переводе', () => {
  it('жилец с другим языком читает перевод с пометкой, и второе чтение идёт из хранилища', async () => {
    const { batches, machine } = service();
    const { app, login } = await setup(machine);

    await publish(app, await login(STAFF_ID, 'Управляющий'));

    const token = await login(JOHN_ID, 'John');
    const [first] = await announcements(app, token);

    assert.equal(first?.title, 'EN: Отключение горячей воды');
    assert.equal(first?.body, 'EN: С понедельника по среду идут плановые работы');
    assert.equal(first?.machineTranslated, true);
    assert.equal(batches.length, 1);

    const [again] = await announcements(app, token);

    assert.equal(again?.title, 'EN: Отключение горячей воды');
    assert.equal(batches.length, 1, 'перевод взят из хранилища');
  });

  it('отказ службы оставляет исходный текст и не ломает ответ', async () => {
    const { app, login } = await setup({
      translate: () => Promise.reject(new Error('служба недоступна')),
    });

    await publish(app, await login(STAFF_ID, 'Управляющий'));

    const [first] = await announcements(app, await login(JOHN_ID, 'John'));

    assert.equal(first?.title, 'Отключение горячей воды');
    assert.equal(first?.machineTranslated, undefined);
  });

  it('у жильца с русским языком запросов к службе нет', async () => {
    const { batches, machine } = service();
    const { app, login } = await setup(machine);

    await publish(app, await login(STAFF_ID, 'Управляющий'));

    const [first] = await announcements(app, await login(MARIA_ID, 'Мария'));

    assert.equal(first?.title, 'Отключение горячей воды');
    assert.equal(batches.length, 0);
  });

  it('смене перевод не подключается, даже когда в её профиле стоит другой язык', async () => {
    const { batches, machine } = service();
    const { app, login } = await setup(machine);

    const token = await login(STAFF_ID, 'Управляющий');

    await publish(app, token);

    const [first] = await announcements(app, token);

    assert.equal(first?.title, 'Отключение горячей воды');
    assert.equal(first?.body, 'С понедельника по среду идут плановые работы');
    assert.equal(batches.length, 0);
  });
});

describe('заявка соседа в ленте дома', () => {
  it('приходит жильцу с другим языком в переводе и с пометкой', async () => {
    const { machine } = service();
    const { app, login } = await setup(machine);

    const author = await login(MARIA_ID, 'Мария');

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(author),
      payload: { description: 'В подъезде не горит свет на втором этаже' },
    });

    assert.equal(created.statusCode, 201, created.body);

    const feed = await app.inject({
      method: 'GET',
      url: '/api/requests/house',
      headers: authed(await login(JOHN_ID, 'John')),
    });

    assert.equal(feed.statusCode, 200, feed.body);

    const [seen] = feed.json<{ title: string; description: string; machineTranslated?: boolean }[]>();

    assert.match(seen?.title ?? '', /^EN: /u);
    assert.match(seen?.description ?? '', /^EN: /u);
    assert.equal(seen?.machineTranslated, true);
  });
});

const doors = async (app: FastifyInstance, token: string) => {
  const list = await app.inject({ method: 'GET', url: '/api/devices', headers: authed(token) });

  assert.equal(list.statusCode, 200, list.body);

  return list.json<{ id: string; title: string }[]>();
};

describe('названия из справочника дома', () => {
  it('двери приходят жильцу переведёнными, а второе чтение берёт их из хранилища', async () => {
    const { batches, machine } = service();
    const { app, login } = await setup(machine);
    const token = await login(JOHN_ID, 'John');

    assert.equal((await doors(app, token))[0]?.title, 'EN: Домофон, подъезд 1');
    assert.equal(batches.length, 1);

    assert.equal((await doors(app, token))[0]?.title, 'EN: Домофон, подъезд 1');
    assert.equal(batches.length, 1, 'название взято из хранилища');
  });

  it('смене двери остаются русскими, и запросов к службе нет', async () => {
    const { batches, machine } = service();
    const { app, login } = await setup(machine);

    assert.equal((await doors(app, await login(STAFF_ID, 'Управляющий')))[0]?.title, 'Домофон, подъезд 1');
    assert.equal(batches.length, 0);
  });

  it('отказ службы оставляет название из справочника', async () => {
    const { app, login } = await setup({ translate: () => Promise.reject(new Error('служба недоступна')) });

    assert.equal((await doors(app, await login(JOHN_ID, 'John')))[0]?.title, 'Домофон, подъезд 1');
  });

  it('«где случилось» в заявке называет оборудование на языке жильца', async () => {
    const { machine } = service();
    const { app, login } = await setup(machine);
    const token = await login(JOHN_ID, 'John');

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: {
        description: 'Лифт застрял между этажами',
        startParam: encodeTarget({ kind: 'equipment', buildingId: BUILDING_ID, equipmentId: LIFT.code }),
      },
    });

    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json<{ request: { target: string } }>().request.target, 'EN: Лифт, подъезд 1');

    const mine = await app.inject({ method: 'GET', url: '/api/requests', headers: authed(token) });

    assert.equal(mine.statusCode, 200, mine.body);
    assert.equal(mine.json<{ target: string }[]>()[0]?.target, 'EN: Лифт, подъезд 1');

    const staff = await app.inject({
      method: 'GET',
      url: '/api/requests?scope=queue',
      headers: authed(await login(STAFF_ID, 'Управляющий')),
    });

    assert.equal(staff.statusCode, 200, staff.body);
    assert.equal(staff.json<{ target: string }[]>()[0]?.target, 'Лифт, подъезд 1');
  });
});
