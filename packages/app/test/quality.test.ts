import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createServiceRequest,
  formatQuality,
  houseQuality,
  transitionRequest,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-20T10:00:00Z');

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const setup = (): AppDeps & { setNow: (at: Date) => void } => {
  let now = NOW;
  let counter = 0;

  const deps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 }],
      residents: [maria, dispatcher],
    }),
    now: () => now,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
  };

  return { ...deps, setNow: (at: Date) => (now = at) };
};

/** Заявка, доведённая до приёмки жильцом. */
const closed = async (deps: AppDeps, description: string, rating?: number): Promise<void> => {
  const request = await createServiceRequest(deps, { resident: maria, description });

  await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'accepted' });
  await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'in_progress' });
  await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'done' });
  await transitionRequest(deps, {
    resident: maria,
    requestId: request.id,
    to: 'confirmed',
    ...(rating === undefined ? {} : { rating }),
  });
};

describe('как работает управляющая компания', () => {
  it('жилец видит те же числа, что и компания у себя', async () => {
    const deps = setup();

    await closed(deps, 'Течёт кран', 5);
    await closed(deps, 'Не горит лампа', 3);
    await createServiceRequest(deps, { resident: maria, description: 'Скрипит дверь' });

    const quality = await houseQuality(deps, maria);

    assert.equal(quality.created, 3);
    assert.equal(quality.closed, 2);
    assert.equal(quality.open, 1);
    assert.equal(quality.inTimeRate, 1);
    assert.equal(quality.rated, 2);
    assert.equal(quality.averageRating, 4);
  });

  it('сравнивать не с чем, пока прошлого месяца у дома нет', async () => {
    const deps = setup();

    await closed(deps, 'Течёт кран');

    assert.equal((await houseQuality(deps, maria)).before, undefined);
  });

  it('без единой закрытой заявки доля «в срок» не показывается вовсе', async () => {
    const deps = setup();

    await createServiceRequest(deps, { resident: maria, description: 'Скрипит дверь' });

    const quality = await houseQuality(deps, maria);

    assert.equal(quality.closed, 0);
    assert.equal(quality.inTimeRate, undefined, 'ноль здесь читался бы как «ни одной в срок»');
    assert.equal(quality.averageHours, undefined);
    assert.equal(quality.averageRating, undefined);
  });

  it('оценка появляется только когда её поставили', async () => {
    const deps = setup();

    await closed(deps, 'Течёт кран');

    const quality = await houseQuality(deps, maria);

    assert.equal(quality.rated, 0);
    assert.equal(quality.averageRating, undefined);
    assert.match(formatQuality(quality), /Закрыто: 1/);
    assert.doesNotMatch(formatQuality(quality), /Оценка жильцов/);
  });

  it('просрочка видна жильцу так же, как и компании', async () => {
    const deps = setup();

    await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });
    deps.setNow(new Date('2026-09-25T10:00:00Z'));

    const quality = await houseQuality(deps, maria);

    assert.equal(quality.open, 1);
    assert.equal(quality.overdue, 1);
    assert.match(formatQuality(quality), /просрочено 1/);
  });

  it('сотруднику этот же счёт доступен без оговорок', async () => {
    const deps = setup();

    await closed(deps, 'Течёт кран');

    assert.equal((await houseQuality(deps, dispatcher)).closed, 1);
  });
});
