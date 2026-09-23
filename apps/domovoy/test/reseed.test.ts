import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, createCollectingNotifier, type AppDeps, type Resident } from '@domovoy/app';

import { demoData, seedDemo } from '../dist/demo.js';
import { realPeople, restorePeople } from '../dist/reseed.js';

const deps = (repository = new InMemoryRepository()): AppDeps => {
  let counter = 0;

  return {
    repository,
    now: () => new Date('2026-09-03T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: demoData().buildingId,
    notifier: createCollectingNotifier(),
  };
};

/** Проверяющий: свой язык, согласие и квартира 5 из набора. */
const reviewer: Resident = {
  id: 'res-reviewer',
  maxUserId: 777001,
  displayName: 'Проверяющий',
  role: 'resident',
  buildingId: demoData().buildingId,
  apartmentId: 'apt-5',
  apartmentIds: ['apt-5'],
  language: 'en',
  legalVersion: 'v1',
};

describe('ночной пересев', () => {
  it('набор заводится заново, а настоящий человек остаётся с языком и квартирой', async () => {
    const before = deps();

    await seedDemo(before);
    await before.repository.saveResident(reviewer);

    const kept = await realPeople(before, async () => [1001, 2001, reviewer.maxUserId as number]);

    assert.deepEqual(
      kept.map((person) => person.maxUserId),
      [reviewer.maxUserId],
      'учётки набора не сохраняются, их заводит сам набор',
    );

    // Пересев: чистое хранилище и свежий набор.
    const after = deps();

    await seedDemo(after);
    await restorePeople(after, kept);

    const back = await after.repository.findResidentByMaxUserId(777001);

    assert.equal(back?.apartmentId, 'apt-5');
    assert.equal(back?.language, 'en');
    assert.equal(back?.legalVersion, 'v1');
  });

  it('без списка людей сохранять некого', async () => {
    assert.deepEqual(await realPeople(deps()), []);
  });
});
