import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, type Resident } from '../dist/index.js';
import { withReadCache } from '../dist/cached-repository.js';

const BUILDING = 'b1';

const staff: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга, диспетчер',
  role: 'dispatcher',
  buildingId: BUILDING,
};

const counting = (): { repository: InMemoryRepository; calls: Map<string, number> } => {
  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING, code: 'Д15', address: 'ул. Ленина, 15' }],
    apartments: [
      { id: 'apt-1', buildingId: BUILDING, number: 1, entrance: 1, riser: 1 },
      { id: 'apt-2', buildingId: BUILDING, number: 2, entrance: 1, riser: 2 },
    ],
    residents: [staff],
  });

  const calls = new Map<string, number>();

  for (const name of ['findApartment', 'findBuilding', 'listApartments', 'listStaff', 'listRequests'] as const) {
    const original = repository[name].bind(repository);

    repository[name] = ((...args: never[]) => {
      calls.set(name, (calls.get(name) ?? 0) + 1);

      return (original as (...rest: never[]) => unknown)(...args);
    }) as never;
  }

  return { repository, calls };
};

describe('кэш справочных чтений', () => {
  it('спрашивает хранилище один раз на ключ', async () => {
    const { repository, calls } = counting();
    const cached = withReadCache(repository);

    const [first, second] = await Promise.all([cached.findApartment('apt-1'), cached.findApartment('apt-1')]);

    assert.equal(first?.number, 1);
    assert.equal(second?.number, 1);
    assert.equal((await cached.findApartment('apt-1'))?.number, 1);
    assert.equal(calls.get('findApartment'), 1);

    await cached.findBuilding(BUILDING);
    await cached.findBuilding(BUILDING);
    assert.equal(calls.get('findBuilding'), 1);

    await cached.listApartments(BUILDING);
    await cached.listApartments(BUILDING);
    assert.equal(calls.get('listApartments'), 1);

    await cached.listStaff(BUILDING);
    await cached.listStaff(BUILDING);
    assert.equal(calls.get('listStaff'), 1);
  });

  it('разные ключи читаются по отдельности', async () => {
    const { repository, calls } = counting();
    const cached = withReadCache(repository);

    assert.equal((await cached.findApartment('apt-1'))?.number, 1);
    assert.equal((await cached.findApartment('apt-2'))?.number, 2);
    assert.equal(await cached.findApartment('apt-404'), undefined);

    assert.equal(calls.get('findApartment'), 3);
  });

  it('остальные чтения и записи уходят в исходное хранилище', async () => {
    const { repository, calls } = counting();
    const cached = withReadCache(repository);

    await cached.saveBuilding({ id: 'b2', code: 'Д17', address: 'ул. Ленина, 17' });

    assert.equal((await repository.findBuilding('b2'))?.code, 'Д17');
    assert.deepEqual(await cached.listRequests({ buildingId: BUILDING }), []);
    assert.equal(calls.get('listRequests'), 1);
  });

  it('неудачное чтение не запоминается', async () => {
    const { repository, calls } = counting();

    let failures = 1;

    repository.findBuilding = async (buildingId: string) => {
      calls.set('findBuilding', (calls.get('findBuilding') ?? 0) + 1);

      if (failures-- > 0) throw new Error('база недоступна');

      return { id: buildingId, code: 'Д15', address: 'ул. Ленина, 15' };
    };

    const cached = withReadCache(repository);

    await assert.rejects(cached.findBuilding(BUILDING), /недоступна/);
    assert.equal((await cached.findBuilding(BUILDING))?.code, 'Д15');
    assert.equal(calls.get('findBuilding'), 2);
  });
});
