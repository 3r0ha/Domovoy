import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '@domovoy/domain';

import {
  InMemoryRepository,
  createServiceRequest,
  equipmentHealth,
  transitionRequest,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-30T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const STAFF: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const RESIDENT: Resident = {
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
  await repository.saveEquipment({ code: 'lift-1', buildingId: BUILDING_ID, title: 'Лифт, подъезд 1' });
  await repository.saveEquipment({ code: 'lift-2', buildingId: BUILDING_ID, title: 'Лифт, подъезд 2' });

  for (const person of [STAFF, RESIDENT]) await repository.saveResident(person);

  const deps = {
    repository,
    now: () => new Date(clock),
    createId: () => `id-${(counter += 1)}`,
    defaultBuildingId: BUILDING_ID,
  };

  /** Поломка лифта в прошлом: важны промежутки, а не сам факт. */
  const broke = async (daysAgo: number, close = true) => {
    clock = NOW.getTime() - daysAgo * DAY;

    const request = await createServiceRequest(deps, {
      resident: RESIDENT,
      description: 'Застряли в лифте',
      startParam: 'eqp_b1_lift-1',
    });

    if (close) {
      clock += 2 * 60 * 60 * 1000;
      await transitionRequest(deps, { resident: STAFF, requestId: request.id, to: 'accepted' });
      await transitionRequest(deps, { resident: STAFF, requestId: request.id, to: 'in_progress' });
      await transitionRequest(deps, { resident: STAFF, requestId: request.id, to: 'done' });
      await transitionRequest(deps, { resident: RESIDENT, requestId: request.id, to: 'confirmed' });
    }

    clock = NOW.getTime();

    return request;
  };

  return { deps, repository, broke };
};

describe('здоровье оборудования', () => {
  it('считает средний промежуток между поломками и ждёт следующую', async () => {
    const { deps, broke } = await setup();

    await broke(30);
    await broke(20);
    await broke(10);

    const [lift] = await equipmentHealth(deps, STAFF);

    assert.equal(lift?.title, 'Лифт, подъезд 1');
    assert.equal(lift?.failures, 3);
    assert.equal(lift?.averageDays, 10);
    assert.equal(lift?.dueInDays, 0);
  });

  it('сломанное сейчас идёт первым', async () => {
    const { deps, broke } = await setup();

    await broke(40);
    await broke(2, false);

    const [first] = await equipmentHealth(deps, STAFF);

    assert.equal(first?.broken, true);
  });

  it('оборудование без поломок не выдумывает срок', async () => {
    const { deps } = await setup();

    const health = await equipmentHealth(deps, STAFF);
    const quiet = health.find((item) => item.code === 'lift-2');

    assert.equal(quiet?.failures, 0);
    assert.equal(quiet?.averageDays, undefined);
    assert.equal(quiet?.dueInDays, undefined);
  });

  it('единственная поломка сроком не считается', async () => {
    const { deps, broke } = await setup();

    await broke(5);

    const lift = (await equipmentHealth(deps, STAFF)).find((item) => item.code === 'lift-1');

    assert.equal(lift?.failures, 1);
    assert.equal(lift?.averageDays, undefined, 'по одной точке промежутка нет');
  });

  it('жильцу обслуживание дома не показывают', async () => {
    const { deps } = await setup();

    await assert.rejects(equipmentHealth(deps, RESIDENT), DomainError);
  });
});
