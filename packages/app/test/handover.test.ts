import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  contactsFor,
  createCollectingNotifier,
  handOverBuilding,
  listServedBuildings,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

/** Дом, который передают, и второй дом той же организации. */
const HANDED = 'b1';
const KEPT = 'b0';
/** Дом организации, которая принимает. */
const THEIRS = 'b2';

const OURS = 'ук-первая';
const OTHER = 'ук-вторая';

const NOW = new Date('2026-09-22T10:00:00Z');

const ourManager: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Нина',
  role: 'manager',
  buildingId: KEPT,
  servesBuildingIds: [HANDED],
};

const ourDispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: HANDED,
};

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: HANDED,
};

/** Сотрудник принимающей организации: в продукте он пока просто житель. */
const heir: Resident = {
  id: 'mgr-2',
  maxUserId: 7008,
  displayName: 'Пётр',
  role: 'resident',
  buildingId: THEIRS,
};

const setup = (residents: Resident[] = [ourManager, ourDispatcher, maria, heir]) => {
  let counter = 0;

  const deps: AppDeps = {
    repository: new InMemoryRepository({
      buildings: [
        { id: HANDED, code: 'Д15', address: 'ул. Ленина, 15', companyId: OURS, managementCompany: 'УК Первая' },
        { id: KEPT, code: 'Д13', address: 'ул. Ленина, 13', companyId: OURS, managementCompany: 'УК Первая' },
        { id: THEIRS, code: 'Д1', address: 'ул. Мира, 1', companyId: OTHER, managementCompany: 'УК Вторая' },
      ],
      apartments: [{ id: 'apt-1', buildingId: HANDED, number: 1, entrance: 1, riser: 1 }],
      residents,
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: HANDED,
    notifier: createCollectingNotifier(),
  };

  return deps;
};

/** Дома, которые человек видит после передачи. */
const housesOf = async (deps: AppDeps, residentId: string): Promise<string[]> => {
  const person = await deps.repository.findResident(residentId);

  return (await listServedBuildings(deps, person!)).map((building) => building.id).sort();
};

describe('передача дома другой управляющей организации', () => {
  it('прежняя организация теряет дом, новая получает', async () => {
    const deps = setup();

    const result = await handOverBuilding(deps, {
      manager: ourManager,
      buildingId: HANDED,
      company: 'УК Вторая',
      managerId: heir.id,
    });

    assert.equal(result.company, 'УК Вторая');

    const building = await deps.repository.findBuilding(HANDED);

    assert.equal(building?.managementCompany, 'УК Вторая');
    assert.equal(building?.companyId, OTHER, 'дом достался организации нового управляющего');

    assert.deepEqual(await housesOf(deps, ourManager.id), [KEPT], 'прежний управляющий дом не видит');
    assert.deepEqual(await housesOf(deps, heir.id), [HANDED, THEIRS], 'новый видит');

    await assert.rejects(
      contactsFor(deps, (await deps.repository.findResident(ourManager.id))!, HANDED),
      /другая управляющая организация/,
    );
  });

  it('управляющему без своей организации дом заводит новую', async () => {
    const local = { ...heir, buildingId: HANDED };
    const deps = setup([ourManager, ourDispatcher, maria, local]);

    await handOverBuilding(deps, {
      manager: ourManager,
      buildingId: HANDED,
      company: 'ТСЖ Ленина 15',
      managerId: local.id,
    });

    const building = await deps.repository.findBuilding(HANDED);

    assert.notEqual(building?.companyId, OURS, 'дом прежней организации больше не принадлежит');
    assert.equal(typeof building?.companyId, 'string');

    assert.deepEqual(await housesOf(deps, ourManager.id), [KEPT]);
    assert.deepEqual(await housesOf(deps, local.id), [HANDED]);
  });
});
