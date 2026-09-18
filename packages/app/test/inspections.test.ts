import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError, INSPECTION_RULES, encodeTarget } from '@domovoy/domain';

import {
  InMemoryRepository,
  checkInspectionItem,
  listInspections,
  planInspections,
  proveInspection,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-20T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const TECHNICIAN: Resident = {
  id: 'staff-1',
  maxUserId: 2002,
  displayName: 'Сергей',
  role: 'technician',
  buildingId: BUILDING_ID,
};

const IVAN: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const setup = async () => {
  const repository = new InMemoryRepository();
  let clock = NOW.getTime();
  let counter = 0;

  await repository.saveBuilding({ id: BUILDING_ID, code: 'Д1', address: 'ул. Ленина, 1', managementCompany: 'УК' });
  await repository.saveApartment({ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 40 });
  await repository.saveApartment({ id: 'apt-9', buildingId: BUILDING_ID, number: 9, entrance: 2, riser: 1, area: 40 });
  await repository.saveResident(TECHNICIAN);
  await repository.saveResident(IVAN);

  const deps = {
    repository,
    now: () => new Date(clock),
    createId: () => `id-${(counter += 1)}`,
    defaultBuildingId: BUILDING_ID,
  };

  return { deps, repository, travel: (days: number) => (clock = NOW.getTime() + days * DAY) };
};

/** Отмечает все пункты «в порядке»: осмотр закрывается сам на последнем. */
const walkThrough = async (deps: Awaited<ReturnType<typeof setup>>['deps'], id: string, count: number) => {
  for (let index = 0; index < count; index += 1) {
    await checkInspectionItem(deps, { resident: TECHNICIAN, inspectionId: id, index, state: 'ok' });
  }
};

describe('плановое обслуживание оборудования', () => {
  it('лифты обслуживаются каждый по своему графику', async () => {
    const { deps, repository } = await setup();

    await repository.saveEquipment({ buildingId: BUILDING_ID, code: 'lift-1', title: 'Лифт 1', kind: 'lift' });
    await deps.repository.saveEquipment({ buildingId: BUILDING_ID, code: 'lift-2', title: 'Лифт 2', kind: 'lift' });
    await deps.repository.saveEquipment({ buildingId: BUILDING_ID, code: 'kod-1', title: 'Табличка' });

    const planned = await planInspections(deps, BUILDING_ID);
    const lifts = planned.filter((round) => round.kind === 'lift');

    assert.deepEqual(
      lifts.map((round) => round.equipmentCode).sort(),
      ['lift-1', 'lift-2'],
    );
    assert.equal(
      planned.some((round) => round.equipmentCode === 'kod-1'),
      false,
    );
  });

  it('второй раз то же оборудование не назначается', async () => {
    const { deps, repository } = await setup();

    await repository.saveEquipment({ buildingId: BUILDING_ID, code: 'lift-1', title: 'Лифт 1', kind: 'lift' });

    await planInspections(deps, BUILDING_ID);

    assert.equal(
      (await planInspections(deps, BUILDING_ID)).some((round) => round.kind === 'lift'),
      false,
    );
  });
});

describe('осмотры общего имущества', () => {
  it('заводятся по подъездам и по дому целиком', async () => {
    const { deps } = await setup();

    const planned = await planInspections(deps, BUILDING_ID);

    assert.deepEqual(
      planned.map((item) => [item.kind, item.entrance]).sort(),
      [
        ['basement', undefined],
        ['entrance', 1],
        ['entrance', 2],
        ['roof', undefined],
        ['ventilation', 1],
        ['ventilation', 2],
      ].sort(),
    );
  });

  it('второй раз не заводятся, пока первый не закончен', async () => {
    const { deps } = await setup();

    const first = await planInspections(deps, BUILDING_ID);

    assert.equal((await planInspections(deps, BUILDING_ID)).length, 0);
    assert.equal((await listInspections(deps, TECHNICIAN)).length, first.length);
  });

  it('следующий заводится, когда прошла периодичность', async () => {
    const { deps, travel } = await setup();

    const [first] = (await planInspections(deps, BUILDING_ID)).filter((item) => item.kind === 'entrance');

    await walkThrough(deps, first!.id, INSPECTION_RULES.entrance.items.length);

    travel(1);
    assert.equal((await planInspections(deps, BUILDING_ID)).length, 0);

    travel(31);
    const again = await planInspections(deps, BUILDING_ID);

    assert.deepEqual(
      again.map((item) => item.kind),
      ['entrance'],
    );
  });

  it('осмотр закрывается сам, когда пройден последний пункт', async () => {
    const { deps } = await setup();

    const [round] = (await planInspections(deps, BUILDING_ID)).filter((item) => item.kind === 'roof');
    const items = INSPECTION_RULES.roof.items.length;

    for (let index = 0; index < items - 1; index += 1) {
      const state = await checkInspectionItem(deps, {
        resident: TECHNICIAN,
        inspectionId: round!.id,
        index,
        state: 'ok',
      });

      assert.equal(state.inspection.finishedAt, undefined);
    }

    const last = await checkInspectionItem(deps, {
      resident: TECHNICIAN,
      inspectionId: round!.id,
      index: items - 1,
      state: 'ok',
    });

    assert.notEqual(last.inspection.finishedAt, undefined);
  });

  it('найденный недостаток становится заявкой по адресу осмотра', async () => {
    const { deps, repository } = await setup();

    const [round] = (await planInspections(deps, BUILDING_ID)).filter(
      (item) => item.kind === 'entrance' && item.entrance === 1,
    );

    const result = await checkInspectionItem(deps, {
      resident: TECHNICIAN,
      inspectionId: round!.id,
      index: 2,
      state: 'problem',
      comment: 'Перила расшатаны на площадке второго этажа',
    });

    assert.ok(result.requestId, 'запись в отчёте, не работа, из неё выходит заявка');
    assert.deepEqual(result.inspection.requestIds, [result.requestId]);

    const request = await repository.findRequest(result.requestId);

    assert.deepEqual(request?.target, { kind: 'entrance', buildingId: BUILDING_ID, entrance: 1 });
    assert.match(request?.description ?? '', /Перила расшатаны/);
  });

  it('отметка осмотра попадает в журнал дома', async () => {
    const { deps, repository } = await setup();

    await repository.saveResident({
      id: 'staff-2',
      maxUserId: 2003,
      displayName: 'Нина',
      role: 'manager',
      buildingId: BUILDING_ID,
    });

    const [round] = (await planInspections(deps, BUILDING_ID)).filter(
      (item) => item.kind === 'entrance' && item.entrance === 1,
    );

    await checkInspectionItem(deps, { resident: TECHNICIAN, inspectionId: round!.id, index: 0, state: 'ok' });

    const entries = (await repository.listAudit(BUILDING_ID, { limit: 10 })).filter(
      (entry) => entry.action === 'inspection_checked',
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.actorName, 'Сергей');
    assert.equal(entries[0]?.subject, INSPECTION_RULES.entrance.title);
    assert.match(entries[0]?.details ?? '', /в порядке$/);
  });

  it('недостаток без объяснения не принимается', async () => {
    const { deps } = await setup();

    const [round] = await planInspections(deps, BUILDING_ID);

    await assert.rejects(
      checkInspectionItem(deps, { resident: TECHNICIAN, inspectionId: round!.id, index: 0, state: 'problem' }),
      /Опишите, что не так/,
    );
  });

  it('законченный осмотр не переписывают', async () => {
    const { deps } = await setup();

    const [round] = (await planInspections(deps, BUILDING_ID)).filter((item) => item.kind === 'roof');

    await walkThrough(deps, round!.id, INSPECTION_RULES.roof.items.length);

    await assert.rejects(
      checkInspectionItem(deps, { resident: TECHNICIAN, inspectionId: round!.id, index: 0, state: 'ok' }),
      /уже закончен/,
    );
  });

  it('незаконченные идут впереди законченных', async () => {
    const { deps } = await setup();

    const planned = await planInspections(deps, BUILDING_ID);
    const roof = planned.find((item) => item.kind === 'roof')!;

    await walkThrough(deps, roof.id, INSPECTION_RULES.roof.items.length);

    const list = await listInspections(deps, TECHNICIAN);

    assert.equal(list.at(-1)?.id, roof.id);
    assert.equal(list[0]?.finishedAt, undefined);
  });

  it('наклейка подъезда подтверждает, что мастер был на месте', async () => {
    const { deps } = await setup();

    const round = (await planInspections(deps, BUILDING_ID)).find(
      (item) => item.kind === 'entrance' && item.entrance === 2,
    )!;

    assert.notEqual(round.onSite, true);

    const proved = await proveInspection(deps, {
      resident: TECHNICIAN,
      inspectionId: round.id,
      code: encodeTarget({ kind: 'entrance', buildingId: BUILDING_ID, entrance: 2 }),
    });

    assert.equal(proved.onSite, true);
    assert.equal((await listInspections(deps, TECHNICIAN)).find((item) => item.id === round.id)?.onSite, true);
  });

  it('наклейка соседнего подъезда выезда не доказывает', async () => {
    const { deps } = await setup();

    const round = (await planInspections(deps, BUILDING_ID)).find(
      (item) => item.kind === 'entrance' && item.entrance === 2,
    )!;

    await assert.rejects(
      proveInspection(deps, {
        resident: TECHNICIAN,
        inspectionId: round.id,
        code: encodeTarget({ kind: 'entrance', buildingId: BUILDING_ID, entrance: 1 }),
      }),
      /наклейка другого объекта/,
    );
  });

  it('плановое ТО подтверждается наклейкой на самом оборудовании', async () => {
    const { deps, repository } = await setup();

    await repository.saveEquipment({ buildingId: BUILDING_ID, code: 'lift-1', title: 'Лифт 1', kind: 'lift' });

    const round = (await planInspections(deps, BUILDING_ID)).find((item) => item.equipmentCode === 'lift-1')!;

    const proved = await proveInspection(deps, {
      resident: TECHNICIAN,
      inspectionId: round.id,
      code: encodeTarget({ kind: 'equipment', buildingId: BUILDING_ID, equipmentId: 'lift-1' }),
    });

    assert.equal(proved.onSite, true);
  });

  it('жильцу осмотры недоступны', async () => {
    const { deps } = await setup();

    const [round] = await planInspections(deps, BUILDING_ID);

    await assert.rejects(listInspections(deps, IVAN), DomainError);
    await assert.rejects(
      checkInspectionItem(deps, { resident: IVAN, inspectionId: round!.id, index: 0, state: 'ok' }),
      DomainError,
    );
  });
});
