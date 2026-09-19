import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, objectPassport, type AppDeps, type Resident } from '../dist/index.js';

/** Две организации на одной установке. */
const OURS = 'b1';
const THEIRS = 'b2';

const APARTMENTS = [
  { id: 'apt-1', buildingId: OURS, number: 1, entrance: 1, riser: 1 },
  { id: 'apt-2', buildingId: THEIRS, number: 2, entrance: 1, riser: 1 },
];

const ourDispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: OURS,
};

const theirDispatcher: Resident = {
  id: 'disp-2',
  maxUserId: 5006,
  displayName: 'Анна',
  role: 'dispatcher',
  buildingId: THEIRS,
};

const ourResident: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  apartmentIds: ['apt-1'],
  buildingId: OURS,
};

/** Зашёл в продукт и больше ничего: ни квартиры, ни дома. */
const stranger: Resident = {
  id: 'res-new',
  maxUserId: 1009,
  displayName: 'Никто',
  role: 'resident',
};

const setup = (): AppDeps => ({
  repository: new InMemoryRepository({
    buildings: [
      { id: OURS, code: 'Д15', address: 'ул. Ленина, 15', companyId: 'ук-первая' },
      { id: THEIRS, code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' },
    ],
    apartments: APARTMENTS,
    residents: [ourDispatcher, theirDispatcher, ourResident, stranger],
  }),
  now: () => new Date('2026-09-22T10:00:00Z'),
  createId: () => 'id-1',
  defaultBuildingId: OURS,
});

describe('паспорт объекта за границей дома', () => {
  it('смена читает объекты своего дома', async () => {
    const passport = await objectPassport(setup(), 'apt_apt-1', ourDispatcher);

    assert.equal(passport?.target, 'квартира 1');
  });

  it('смена не читает квартиру дома чужой организации', async () => {
    await assert.rejects(objectPassport(setup(), 'apt_apt-2', ourDispatcher), /другому дому/);
  });

  it('смена не читает общее имущество дома чужой организации', async () => {
    await assert.rejects(objectPassport(setup(), 'eqp_b2_lift-1', ourDispatcher), /другому дому/);
    await assert.rejects(objectPassport(setup(), 'ent_b2_1', ourDispatcher), /другому дому/);
  });

  it('своя смена тот же объект читает: дело в доме, а не в коде', async () => {
    const passport = await objectPassport(setup(), 'apt_apt-2', theirDispatcher);

    assert.equal(passport?.target, 'квартира 2');
  });

  it('жилец не читает соседскую квартиру, а общее имущество дома читает', async () => {
    await assert.rejects(objectPassport(setup(), 'apt_apt-2', ourResident), /другому дому/);

    const passport = await objectPassport(setup(), 'ent_b1_1', ourResident);

    assert.equal(passport?.startParam, 'ent_b1_1');
  });

  it('человеку без дома объект дома по умолчанию не показывают', async () => {
    await assert.rejects(objectPassport(setup(), 'ent_b1_1', stranger), /другому дому/);
    await assert.rejects(objectPassport(setup(), 'apt_apt-1', stranger), /другому дому/);
  });

  it('несуществующий код остаётся пустым ответом, а не отказом', async () => {
    assert.equal(await objectPassport(setup(), 'ерунда', ourDispatcher), null);
  });
});
