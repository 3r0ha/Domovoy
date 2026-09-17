import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  contactForRequest,
  createServiceRequest,
  forgetContact,
  saveContact,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const neighbour: Resident = { ...maria, id: 'res-2', maxUserId: 1002, displayName: 'Иван', apartmentId: 'apt-2' };

const dispatcher: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const contractor: Resident = { ...dispatcher, id: 'con-1', maxUserId: 9009, role: 'contractor' };

const setup = (): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
      ],
      residents: [maria, neighbour, dispatcher, contractor],
    }),
    now: () => new Date('2026-09-07T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
  };
};

describe('телефон жильца', () => {
  it('сохраняется без пробелов и скобок', async () => {
    const deps = setup();

    const saved = await saveContact(deps, maria, '+7 (999) 123-45-67');

    assert.equal(saved.phone, '+79991234567');
  });

  it('не похожее на номер не принимается', async () => {
    const deps = setup();

    await assert.rejects(saveContact(deps, maria, 'позвоните в дверь'), /не похож на номер/);
  });

  it('виден смене по заявке, а подрядчику и соседу, нет', async () => {
    const deps = setup();

    await saveContact(deps, maria, '+79991234567');

    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });
    const seen = await contactForRequest(deps, dispatcher, request.id);

    assert.deepEqual(seen, { displayName: 'Мария', phone: '+79991234567' });

    for (const person of [contractor, neighbour]) {
      await assert.rejects(contactForRequest(deps, person, request.id), /управляющая компания/);
    }
  });

  it('убирается по требованию человека', async () => {
    const deps = setup();

    await saveContact(deps, maria, '+79991234567');

    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    await forgetContact(deps, (await deps.repository.findResident(maria.id))!);

    assert.deepEqual(await contactForRequest(deps, dispatcher, request.id), { displayName: 'Мария' });
  });
});
