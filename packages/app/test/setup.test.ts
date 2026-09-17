import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  addBuilding,
  bindHouseChat,
  buildingByChat,
  listServedBuildings,
  openBuilding,
  unbindHouseChat,
  importApartments,
  importEquipment,
  listAudit,
  makeManager,
  planInspections,
  releaseHouseChat,
  updateBuilding,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

const newcomer: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  buildingId: BUILDING_ID,
};

const setup = (residents: Resident[] = []): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д1' }],
      residents,
    }),
    now: () => new Date('2026-09-07T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
  };
};

describe('первый управляющий', () => {
  it('заводится в пустой базе, где раздать роли некому', async () => {
    const deps = setup();

    const manager = await makeManager(deps, 7007, 'Нина');

    assert.equal(manager.role, 'manager');
    assert.equal(manager.buildingId, BUILDING_ID);
    assert.equal((await deps.repository.findResidentByMaxUserId(7007))?.role, 'manager');
  });

  it('повышает уже знакомого человека, не заводя второго профиля', async () => {
    const deps = setup([newcomer]);

    const manager = await makeManager(deps, newcomer.maxUserId!);

    assert.equal(manager.id, newcomer.id);
    assert.equal(manager.displayName, 'Мария');
    assert.equal((await deps.repository.listStaff(BUILDING_ID)).length, 1);
  });
});

describe('карточка дома', () => {
  it('задаёт адрес и часовой пояс', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007, 'Нина');

    const building = await updateBuilding(deps, manager, {
      code: 'Д15',
      address: 'ул. Ленина, 15',
      timeZone: 'Asia/Yekaterinburg',
    });

    assert.equal(building.timeZone, 'Asia/Yekaterinburg');
    assert.equal((await deps.repository.findBuilding(BUILDING_ID))?.address, 'ул. Ленина, 15');
    assert.equal((await listAudit(deps, manager))[0]?.action, 'building_updated');
  });

  it('несуществующий пояс не принимается', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007);

    await assert.rejects(updateBuilding(deps, manager, { timeZone: 'Луна/Море_Спокойствия' }), /не опознан/);
  });

  it('карточку ведёт управляющий', async () => {
    const deps = setup([newcomer]);

    await assert.rejects(updateBuilding(deps, newcomer, { address: 'ул. Ленина, 15' }), /ведёт управляющий/);
  });
});

describe('новый дом', () => {
  it('заводится управляющим и сразу оказывается в его списке домов', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007, 'Нина');

    const building = await openBuilding(deps, manager, { code: 'Д17', address: 'ул. Ленина, 17' });

    assert.equal(building.address, 'ул. Ленина, 17');

    const saved = await deps.repository.findResidentByMaxUserId(7007);

    assert.deepEqual(
      (await listServedBuildings(deps, saved!)).map((item) => item.code),
      ['Д1', 'Д17'],
    );
    assert.equal((await listAudit(deps, manager))[0]?.action, 'building_added');
  });

  it('наследует организацию от дома управляющего: чужую из приложения не завести', async () => {
    const deps = setup();

    await deps.repository.saveBuilding({ id: BUILDING_ID, code: 'Д1', address: '', companyId: 'ук-первая' });

    const manager = await makeManager(deps, 7007, 'Нина');
    const building = await openBuilding(deps, manager, { code: 'Д17' });

    assert.equal(building.companyId, 'ук-первая');
  });

  it('код дома в одной организации не повторяется', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007, 'Нина');

    await assert.rejects(openBuilding(deps, manager, { code: 'Д1' }), /уже есть/);
  });

  it('тот же код у другой организации, разные дома', async () => {
    const deps = setup();

    const building = await addBuilding(deps, { code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' });

    assert.equal(building.companyId, 'ук-вторая');
    assert.equal((await deps.repository.listBuildings()).length, 2);
  });

  it('дома заводит управляющий, а не диспетчер', async () => {
    const deps = setup([{ ...newcomer, role: 'dispatcher' }]);

    await assert.rejects(openBuilding(deps, { ...newcomer, role: 'dispatcher' }, { code: 'Д17' }), /заводит управляющий/);
  });
});

describe('чат дома', () => {
  it('привязывается управляющим и переживает правку карточки', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007, 'Нина');

    await updateBuilding(deps, manager, { code: 'Д15', address: 'ул. Ленина, 15' });
    await bindHouseChat(deps, manager, 777);

    await updateBuilding(deps, manager, { address: 'ул. Ленина, 15, корпус 2' });

    const building = await deps.repository.findBuilding(BUILDING_ID);

    assert.equal(building?.chatId, 777);
    assert.equal(building?.address, 'ул. Ленина, 15, корпус 2');
  });

  it('чат привязывает только управляющий', async () => {
    const deps = setup([newcomer]);

    await assert.rejects(bindHouseChat(deps, newcomer, 777), /привязывает управляющий/);
  });

  it('привязка попадает в журнал действий', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007, 'Нина');

    await bindHouseChat(deps, manager, 777);

    assert.match((await listAudit(deps, manager))[0]?.subject ?? '', /чат дома/);
  });

  it('по чату находится дом: из него и берётся адрес заявки', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007, 'Нина');

    await bindHouseChat(deps, manager, 777);

    assert.equal((await buildingByChat(deps, 777))?.id, BUILDING_ID);
    assert.equal(await buildingByChat(deps, 778), undefined);
  });

  it('чужой чат к своему дому не привязывается', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007, 'Нина');

    await deps.repository.saveBuilding({ id: 'b2', code: 'Д16', address: 'ул. Ленина, 16', chatId: 777 });

    await assert.rejects(bindHouseChat(deps, manager, 777), /уже привязан к дому/);
  });

  it('управляющий отвязывает чат из приложения, и это видно в журнале', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007, 'Нина');

    await bindHouseChat(deps, manager, 777);

    const released = await releaseHouseChat(deps, manager);

    assert.equal(released.chatId, undefined);
    assert.equal(await buildingByChat(deps, 777), undefined);
    assert.match((await listAudit(deps, manager)).at(-1)?.subject ?? '', /отвязан/);
  });

  it('чат отвязывает только управляющий', async () => {
    const deps = setup([newcomer]);

    await assert.rejects(releaseHouseChat(deps, newcomer), /отвязывает управляющий/);
  });

  it('после удаления бота чат отвязывается', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007, 'Нина');

    await bindHouseChat(deps, manager, 777);
    await unbindHouseChat(deps, 777);

    assert.equal((await deps.repository.findBuilding(BUILDING_ID))?.chatId, undefined);
    assert.equal(await buildingByChat(deps, 777), undefined);
  });
});

describe('оборудование дома', () => {
  const FILE = ['Код;Название;Вид', 'lift-1;Лифт, подъезд 1;лифт', 'uzel-1;Узел учёта;узел учета'].join('\n');

  it('заводится списком, и по видам сразу назначается обслуживание', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007);

    const result = await importEquipment(deps, manager, FILE);

    assert.deepEqual([result.added, result.problems.length], [2, 0]);

    const kinds = (await deps.repository.listEquipment(BUILDING_ID)).map((item) => item.kind).sort();

    assert.deepEqual(kinds, ['lift', 'meter_unit']);

    const planned = await planInspections(deps, BUILDING_ID);

    assert.deepEqual(
      planned
        .filter((round) => round.equipmentCode)
        .map((round) => round.equipmentCode)
        .sort(),
      ['lift-1', 'uzel-1'],
    );
  });

  it('неизвестный вид называется ошибкой, а не молчаливым «прочим»', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007);

    const result = await importEquipment(deps, manager, 'Код;Название;Вид\nx-1;Ворота;телепорт');

    assert.equal(result.added, 0);
    assert.match(result.problems[0]?.message ?? '', /не опознан/);
  });

  it('дом с оборудованием и квартирами заводится двумя файлами', async () => {
    const deps = setup();
    const manager = await makeManager(deps, 7007);

    await importEquipment(deps, manager, FILE);
    await importApartments(deps, manager, 'Помещение;Подъезд;Площадь\n1;1;54,3');

    assert.equal((await deps.repository.listApartments(BUILDING_ID)).length, 1);
    assert.equal((await deps.repository.listEquipment(BUILDING_ID)).length, 2);
  });
});
