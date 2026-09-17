import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, atBuilding, listServedBuildings, type AppDeps, type Resident } from '../dist/index.js';

const FIRST = 'b1';
const SECOND = 'b2';

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
      { id: SECOND, code: 'Д17', address: 'ул. Ленина, 17' },
      { id: FIRST, code: 'Д15', address: 'ул. Ленина, 15', timeZone: 'Asia/Vladivostok', managementCompany: 'УК' },
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

    await deps.repository.saveBuilding({ id: SECOND, code: 'Д17', address: 'ул. Ленина, 17', chatId: 777 });

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

  it('без привязки к дому человек работает с домом по умолчанию', async () => {
    const list = await listServedBuildings(setup(), person('resident'));

    assert.deepEqual(
      list.map((building) => [building.code, building.current]),
      [['Д15', true]],
    );
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

    await assert.rejects(
      atBuilding(deps, person('dispatcher', FIRST), 'b3'),
      /Дом обслуживает другая управляющая организация/,
    );
  });

  it('опечатка в адресе дома, отказ, а не пустой список', async () => {
    await assert.rejects(atBuilding(setup(), person('manager', FIRST), 'нет-такого'), /Дом не найден/);
  });
});
