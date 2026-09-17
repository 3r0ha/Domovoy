import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { READING_WINDOW } from '@domovoy/domain';

import {
  InMemoryRepository,
  metersFor,
  remindAboutReadings,
  submitReading,
  zoneOf,
  type Notification,
  type Resident,
} from '../dist/index.js';

const MOSCOW = 'moscow';
const VLADIVOSTOK = 'vladivostok';

const setup = async (at: Date) => {
  const repository = new InMemoryRepository();
  const sent: Notification[] = [];
  let counter = 0;

  await repository.saveBuilding({ id: MOSCOW, code: 'М1', address: 'Москва', managementCompany: 'УК' });
  await repository.saveBuilding({
    id: VLADIVOSTOK,
    code: 'В1',
    address: 'Владивосток',
    managementCompany: 'УК',
    timeZone: 'Asia/Vladivostok',
  });

  for (const [buildingId, apartmentId] of [
    [MOSCOW, 'apt-m'],
    [VLADIVOSTOK, 'apt-v'],
  ] as const) {
    await repository.saveApartment({ id: apartmentId, buildingId, number: 1, entrance: 1, riser: 1, area: 40 });
    await repository.saveMeter({ id: `cold-${apartmentId}`, apartmentId, kind: 'cold_water', serial: 'ХВС' });
    await repository.saveResident({
      id: `res-${apartmentId}`,
      maxUserId: apartmentId === 'apt-m' ? 1001 : 1002,
      displayName: 'Жилец',
      role: 'resident',
      apartmentId,
      buildingId,
    });
  }

  return {
    repository,
    sent,
    deps: {
      repository,
      now: () => at,
      createId: () => `id-${(counter += 1)}`,
      defaultBuildingId: MOSCOW,
      notifier: {
        async send(notification: Notification) {
          sent.push(notification);
        },
      },
    },
    resident: async (id: string): Promise<Resident> => (await repository.findResident(id))!,
  };
};

describe('время дома', () => {
  it('берётся у дома, а без него, московское', async () => {
    const { deps } = await setup(new Date('2026-09-20T10:00:00Z'));

    assert.equal(await zoneOf(deps, VLADIVOSTOK), 'Asia/Vladivostok');
    assert.equal(await zoneOf(deps, MOSCOW), 'Europe/Moscow');
    assert.equal(await zoneOf(deps, undefined), 'Europe/Moscow');
  });

  it('окно подачи показаний открывается по календарю дома', async () => {
    const { deps } = await setup(new Date('2026-09-19T20:00:00Z'));

    assert.equal(READING_WINDOW.fromDay, 20);
    assert.deepEqual(await remindAboutReadings(deps, MOSCOW), []);
    assert.equal((await remindAboutReadings(deps, VLADIVOSTOK)).length, 1, 'на востоке окно уже открылось');
  });

  it('месяц подачи считается по дому, а не по UTC', async () => {
    const submitted = await setup(new Date('2026-09-30T20:00:00Z'));

    await submitReading(submitted.deps, {
      resident: await submitted.resident('res-apt-v'),
      meterId: 'cold-apt-v',
      value: 100,
    });

    const [state] = await metersFor(submitted.deps, await submitted.resident('res-apt-v'));

    assert.equal(state?.submittedThisMonth, true, 'показание подано в октябре по местному календарю');

    const moscow = await setup(new Date('2026-09-30T20:00:00Z'));

    await submitReading(moscow.deps, {
      resident: await moscow.resident('res-apt-m'),
      meterId: 'cold-apt-m',
      value: 100,
    });

    const [moscowState] = await metersFor(moscow.deps, await moscow.resident('res-apt-m'));

    assert.equal(moscowState?.submittedThisMonth, true);
  });
});
