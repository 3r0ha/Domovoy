import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  chargesForResident,
  setTariff,
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

const nina: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

/** Показания подавали в январе и феврале, дальше человек замолчал. */
const setup = async (now: string) => {
  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
    apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50, residents: 2 }],
    residents: [maria, nina],
  });

  let counter = 0;
  const deps: AppDeps = {
    repository,
    now: () => new Date(now),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
  };

  await setTariff(deps, nina, { kind: 'maintenance', value: 0, since: new Date('2020-01-01T00:00:00Z') });
  await setTariff(deps, nina, { kind: 'cold_water', value: 50, since: new Date('2020-01-01T00:00:00Z') });
  await repository.saveMeter({ id: 'm-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

  for (const [id, value, at] of [
    ['r-0', 100, '2026-01-20T10:00:00Z'],
    ['r-1', 110, '2026-02-20T10:00:00Z'],
  ] as const) {
    await repository.saveReading({ id, meterId: 'm-1', value, at: new Date(at), submittedBy: maria.id });
  }

  return deps;
};

const water = async (deps: AppDeps) =>
  (await chargesForResident(deps, maria)).lines.find((line) => line.title === 'Холодная вода');

describe('квитанция без свежих показаний', () => {
  it('месяц после показания считается по счётчику', async () => {
    const line = await water(await setup('2026-03-05T10:00:00Z'));

    assert.equal(line?.amount, 500);
    assert.match(line?.detail ?? '', /^10 м³ × 50 ₽$/);
  });

  it('три месяца молчания, по среднему, и это сказано в строке', async () => {
    const line = await water(await setup('2026-06-05T10:00:00Z'));

    assert.match(line?.detail ?? '', /по среднему/);
  });

  it('дальше, по нормативу, а не по расходу позапрошлого года', async () => {
    const line = await water(await setup('2026-12-05T10:00:00Z'));

    assert.match(line?.detail ?? '', /по нормативу/);
    assert.equal(line?.amount, 727.5);
  });

  it('через год норматив не растёт и не превращается обратно в дельту', async () => {
    const later = await water(await setup('2027-12-05T10:00:00Z'));
    const earlier = await water(await setup('2026-12-05T10:00:00Z'));

    assert.equal(later?.amount, earlier?.amount);
    assert.match(later?.detail ?? '', /по нормативу/);
  });

  it('свежее показание возвращает счёт к счётчику', async () => {
    const deps = await setup('2026-12-05T10:00:00Z');

    await deps.repository.saveReading({
      id: 'r-2',
      meterId: 'm-1',
      value: 118,
      at: new Date('2026-11-20T10:00:00Z'),
      submittedBy: maria.id,
    });

    const line = await water(deps);

    assert.equal(line?.amount, 400);
    assert.doesNotMatch(line?.detail ?? '', /по нормативу|по среднему/);
  });
});
