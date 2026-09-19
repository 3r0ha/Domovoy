import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  atBuilding,
  contactsFor,
  listServedBuildings,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const FIRST = 'b1';
const SECOND = 'b2';

/** Обоими домами установки ведает одна организация. */
const COMPANY = 'ук-первая';

const person = (role: Resident['role'], buildingId?: string): Resident => ({
  id: `res-${role}`,
  maxUserId: 1001,
  displayName: 'Кто-то',
  role,
  ...(buildingId ? { buildingId } : {}),
});

const setup = (): AppDeps => ({
  repository: new InMemoryRepository({
    buildings: [
      { id: SECOND, code: 'Д17', address: 'ул. Ленина, 17', companyId: COMPANY },
      {
        id: FIRST,
        code: 'Д15',
        address: 'ул. Ленина, 15',
        timeZone: 'Asia/Vladivostok',
        managementCompany: 'УК',
        companyId: COMPANY,
      },
    ],
    apartments: [],
    residents: [],
  }),
  now: () => new Date('2026-09-07T06:00:00Z'),
  createId: () => 'id-1',
  defaultBuildingId: FIRST,
});

/** Установка, в которой у домов владельца нет: их завели порознь. */
const ownerless = (): AppDeps => ({
  repository: new InMemoryRepository({
    buildings: [
      { id: FIRST, code: 'Д15', address: 'ул. Ленина, 15', managementCompany: 'УК Первая' },
      { id: SECOND, code: 'Д17', address: 'ул. Мира, 17', managementCompany: 'УК Вторая' },
    ],
    apartments: [],
    residents: [],
  }),
  now: () => new Date('2026-09-07T06:00:00Z'),
  createId: () => 'id-1',
  defaultBuildingId: FIRST,
});

describe('дома компании', () => {
  it('сотруднику отдают все дома по алфавиту и отмечают его собственный', async () => {
    const list = await listServedBuildings(setup(), person('dispatcher', FIRST));

    assert.deepEqual(
      list.map((building) => [building.code, building.current]),
      [
        ['Д15', true],
        ['Д17', false],
      ],
    );
  });

  it('жилец видит только свой дом: переключать ему нечего', async () => {
    const list = await listServedBuildings(setup(), person('resident', SECOND));

    assert.deepEqual(
      list.map((building) => building.code),
      ['Д17'],
    );
  });

  it('пояс и управляющая компания едут вместе с домом, а пустые поля не выдумываются', async () => {
    const [first, second] = await listServedBuildings(setup(), person('manager', FIRST));

    assert.equal(first?.timeZone, 'Asia/Vladivostok');
    assert.equal(first?.managementCompany, 'УК');
    assert.equal('timeZone' in (second ?? {}), false);
    assert.equal('managementCompany' in (second ?? {}), false);
  });

  it('в списке видно, у какого дома есть свой чат', async () => {
    const deps = setup();

    await deps.repository.saveBuilding({
      id: SECOND,
      code: 'Д17',
      address: 'ул. Ленина, 17',
      companyId: COMPANY,
      chatId: 777,
    });

    const list = await listServedBuildings(deps, person('manager', FIRST));

    assert.deepEqual(
      list.map((building) => [building.code, building.chatBound]),
      [
        ['Д15', false],
        ['Д17', true],
      ],
    );
  });

  it('дома чужой управляющей организации в список не попадают', async () => {
    const deps = setup();

    await deps.repository.saveBuilding({ id: 'b3', code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' });

    const list = await listServedBuildings(deps, person('manager', FIRST));

    assert.deepEqual(
      list.map((building) => building.code),
      ['Д15', 'Д17'],
    );
  });

  it('дом, отданный сотруднику вручную, виден и через границу организаций', async () => {
    const deps = setup();

    await deps.repository.saveBuilding({ id: 'b3', code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' });

    const list = await listServedBuildings(deps, { ...person('technician', FIRST), servesBuildingIds: ['b3'] });

    assert.deepEqual(
      list.map((building) => building.code),
      ['Д1', 'Д15', 'Д17'],
    );
  });

  it('человеку без дома дом по умолчанию не достаётся', async () => {
    assert.deepEqual(await listServedBuildings(setup(), person('resident')), []);
    assert.deepEqual(await listServedBuildings(setup(), person('dispatcher')), []);
  });

  it('дома без владельца сходятся в один парк только вместе со своим владельцем', async () => {
    const deps = ownerless();

    const list = await listServedBuildings(deps, person('manager', FIRST));

    assert.deepEqual(
      list.map((building) => building.code),
      ['Д15'],
      'дом другой организации без владельца всё равно чужой',
    );
  });
});

describe('дом без владельца', () => {
  it('контакты соседней организации не отдают', async () => {
    await assert.rejects(
      contactsFor(ownerless(), person('dispatcher', FIRST), SECOND),
      /другая управляющая организация/,
    );
  });

  it('человек без дома не получает контакты дома по умолчанию', async () => {
    await assert.rejects(contactsFor(setup(), person('resident')), /другая управляющая организация/);
  });

  it('дом остаётся своим для того, кто его ведёт', async () => {
    const contacts = await contactsFor(ownerless(), person('manager', FIRST), FIRST);

    assert.equal(contacts.buildingId, FIRST);
  });
});

describe('работа в выбранном доме', () => {
  it('свой дом переключением не считается', async () => {
    const deps = setup();
    const staff = person('dispatcher', FIRST);

    assert.equal(await atBuilding(deps, staff, FIRST), staff, 'тот же объект, без лишнего чтения базы');
    assert.equal(await atBuilding(deps, staff, undefined), staff);
  });

  it('сотрудник переходит в другой дом и дальше работает от его имени', async () => {
    const deps = setup();
    const switched = await atBuilding(deps, person('dispatcher', FIRST), SECOND);

    assert.equal(switched.buildingId, SECOND);
    assert.equal(switched.role, 'dispatcher', 'права остаются прежними');
  });

  it('подрядчик, тоже сотрудник компании, но чужой: дом ему не переключают', async () => {
    await assert.rejects(atBuilding(setup(), person('contractor', FIRST), SECOND), /Чужой дом видят только сотрудники/);
  });

  it('жильцу чужой дом не отдают даже по прямому запросу', async () => {
    await assert.rejects(atBuilding(setup(), person('resident', FIRST), SECOND), /Чужой дом видят только сотрудники/);
  });

  it('дом чужой организации сотруднику не переключают', async () => {
    const deps = setup();

    await deps.repository.saveBuilding({ id: 'b3', code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' });

    await assert.rejects(atBuilding(deps, person('dispatcher', FIRST), 'b3'), /Дом не найден/);
  });

  it('опечатка в адресе дома, отказ, а не пустой список', async () => {
    await assert.rejects(atBuilding(setup(), person('manager', FIRST), 'нет-такого'), /Дом не найден/);
  });

  it('чужой дом и несуществующий отвечают одинаково: состав установки перебором не читается', async () => {
    const deps = setup();

    await deps.repository.saveBuilding({ id: 'b3', code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' });

    const staff = person('dispatcher', FIRST);

    const refusal = async (buildingId: string): Promise<string> => {
      try {
        await atBuilding(deps, staff, buildingId);

        return 'дом отдали';
      } catch (error) {
        const failed = error as { code?: string; message: string };

        return `${failed.code ?? ''}: ${failed.message}`;
      }
    };

    assert.equal(await refusal('b3'), await refusal('b4'));
    assert.match(await refusal('b3'), /Дом не найден/);
  });
});
