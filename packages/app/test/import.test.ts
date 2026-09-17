import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  importApartments,
  listAudit,
  parseApartments,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

const manager: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = { ...manager, id: 'disp-1', maxUserId: 2001, role: 'dispatcher' };

const setup = (): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      residents: [manager, dispatcher],
    }),
    now: () => new Date('2026-09-07T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
  };
};

const FILE = [
  'Помещение;Подъезд;Стояк;Площадь;ХВС;ГВС;Электричество',
  '1;1;1;54,3;ХВС-001;ГВС-001;ЭЛ-001',
  '2;1;2;41,8;ХВС-002;;',
].join('\n');

describe('разбор списка квартир', () => {
  it('читает колонки по названиям, а площадь, с запятой', () => {
    const { rows, problems } = parseApartments(FILE);

    assert.deepEqual(problems, []);
    assert.deepEqual(rows[0], {
      number: 1,
      entrance: 1,
      riser: 1,
      area: 54.3,
      meters: [
        { kind: 'cold_water', serial: 'ХВС-001' },
        { kind: 'hot_water', serial: 'ГВС-001' },
        { kind: 'electricity', serial: 'ЭЛ-001' },
      ],
    });
    assert.deepEqual(rows[1]?.meters, [{ kind: 'cold_water', serial: 'ХВС-002' }]);
  });

  it('читает число проживающих: по нему считается норматив', () => {
    const { rows, problems } = parseApartments('Помещение;Площадь;Жильцов\n1;30;3\n2;40;\n');

    assert.deepEqual(problems, []);
    assert.equal(rows[0]?.residents, 3);
    assert.equal(rows[1]?.residents, undefined);
  });

  it('понимает запятую как разделитель и метку порядка байтов', () => {
    const { rows } = parseApartments('﻿Квартира,Подъезд\n7,2\n');

    assert.deepEqual(rows, [{ number: 7, entrance: 2, riser: 1, meters: [] }]);
  });

  it('строку с ошибкой называет, а остальные заводит', () => {
    const { rows, problems } = parseApartments('Помещение;Площадь\n1;30\n2;тридцать\n;40\n1;25');

    assert.deepEqual(
      rows.map((row) => row.number),
      [1],
    );
    assert.deepEqual(
      problems.map((problem) => problem.line),
      [3, 4, 5],
    );
    assert.match(problems[2]?.message ?? '', /второй раз/);
  });

  it('без колонки с номером помещения файл не читается', () => {
    const { problems } = parseApartments('Подъезд;Площадь\n1;30');

    assert.match(problems[0]?.message ?? '', /номером помещения/);
  });
});

describe('заведение дома', () => {
  it('создаёт квартиры и приборы', async () => {
    const deps = setup();

    const result = await importApartments(deps, manager, FILE);

    assert.deepEqual([result.added, result.updated, result.meters], [2, 0, 4]);

    const apartments = await deps.repository.listApartments(BUILDING_ID);
    const first = apartments.find((apartment) => apartment.number === 1);

    assert.equal(apartments.length, 2);
    assert.equal(first?.area, 54.3);
    assert.equal((await deps.repository.listMeters(first.id)).length, 3);
  });

  it('повторный импорт обновляет дом, а не удваивает его', async () => {
    const deps = setup();

    await importApartments(deps, manager, FILE);

    const before = await deps.repository.listApartments(BUILDING_ID);
    const result = await importApartments(deps, manager, FILE.replace('54,3', '55'));
    const after = await deps.repository.listApartments(BUILDING_ID);

    assert.deepEqual([result.added, result.updated], [0, 2]);
    assert.equal(after.length, 2);
    assert.deepEqual(
      after.map((apartment) => apartment.id).sort(),
      before.map((apartment) => apartment.id).sort(),
    );
    assert.equal(after.find((apartment) => apartment.number === 1)?.area, 55);
  });

  it('замена счётчика не заводит второй прибор того же ресурса', async () => {
    const deps = setup();

    await importApartments(deps, manager, FILE);
    await importApartments(deps, manager, FILE.replace('ХВС-001', 'ХВС-777'));

    const [apartment] = await deps.repository.listApartments(BUILDING_ID);
    const meters = await deps.repository.listMeters(apartment!.id);
    const cold = meters.filter((meter) => meter.kind === 'cold_water');

    assert.equal(cold.length, 1);
    assert.equal(cold[0]?.serial, 'ХВС-777');
  });

  it('дом заводит управляющий, и это видно в журнале', async () => {
    const deps = setup();

    await assert.rejects(importApartments(deps, dispatcher, FILE), /заводит управляющий/);

    await importApartments(deps, manager, FILE);

    const [entry] = await listAudit(deps, manager);

    assert.equal(entry?.action, 'data_imported');
    assert.equal(entry?.subject, '2 помещений');
  });
});
