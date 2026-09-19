import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  addBuilding,
  importApartments,
  importEquipment,
  makeManager,
  type AppDeps,
} from '@domovoy/app';

/** Файлы отданы жюри как тестовые данные: они обязаны заводиться импортом продукта. */
const read = (name: string): Promise<string> => readFile(new URL(`../../../testdata/${name}`, import.meta.url), 'utf8');

const setup = async (): Promise<AppDeps> => {
  let counter = 0;
  const deps: AppDeps = {
    repository: new InMemoryRepository(),
    now: () => new Date('2026-09-22T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: 'dom15',
  };

  await addBuilding(deps, { code: 'Д15', address: 'ул. Ленина, 15' });

  return deps;
};

describe('тестовые данные для проверки', () => {
  it('квартиры заводятся импортом без замечаний', async () => {
    const deps = await setup();
    const manager = await makeManager(deps, 2003, 'Нина');

    const result = await importApartments(deps, manager, await read('apartments.csv'));

    assert.deepEqual(result.problems, []);
    assert.equal(result.added, 12);
    assert.equal(result.meters, 36, 'по три прибора на помещение');
  });

  it('оборудование заводится импортом без замечаний', async () => {
    const deps = await setup();
    const manager = await makeManager(deps, 2003, 'Нина');

    const result = await importEquipment(deps, manager, await read('equipment.csv'));

    assert.deepEqual(result.problems, []);
    assert.equal(result.added, 4);

    const saved = await deps.repository.listEquipment(manager.buildingId ?? 'dom15');

    assert.deepEqual(
      saved.map((item) => item.kind),
      ['lift', 'lift', 'intercom', 'meter_unit'],
    );
  });

  it('выгрузка в JSON описывает людей, дома и заявки', async () => {
    const dump = JSON.parse(await read('demo.json')) as {
      people: { maxUserId: number | null; role: string }[];
      houses: { id: string; apartments: unknown[]; requests: unknown[] }[];
    };

    const roles = new Set(dump.people.map((person) => person.role));

    for (const role of ['resident', 'dispatcher', 'technician', 'manager', 'contractor']) {
      assert.ok(roles.has(role), `в наборе нет роли ${role}`);
    }

    assert.deepEqual(
      dump.people.filter((person) => person.role === 'dispatcher').map((person) => person.maxUserId),
      [2001],
    );

    const main = dump.houses.find((house) => house.id === 'dom15');

    assert.ok(main, 'в наборе нет дома dom15');
    assert.equal(main.apartments.length, 12);
    assert.ok(main.requests.length > 0, 'в наборе нет заявок');
  });
});
