import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createCollectingNotifier,
  createSweeper,
  escalationFor,
  submitProblem,
  submitReading,
  transitionRequest,
  type AppDeps,
  type Resident,
  type SweepState,
  type SweepStore,
} from '../dist/index.js';

/** Дом на Дальнем Востоке: там сутки начинаются на семь часов раньше московских. */
const BUILDING_ID = 'b1';
const ZONE = 'Asia/Vladivostok';

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  apartmentIds: ['apt-1'],
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const store = (initial: SweepState = {}): SweepStore & { state: SweepState } => {
  let state = initial;

  return {
    get state() {
      return state;
    },
    load: async () => state,
    save: async (next) => void (state = next),
  };
};

const setup = (now: Date): AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> } => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', timeZone: ZONE }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
      residents: [maria, dispatcher],
    }),
    now: () => now,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
  };
};

describe('дом живёт по своему времени, а не по серверному', () => {
  it('показание в ночь на первое число попадает в новый месяц', async () => {
    // 30 сентября 17:00 UTC это 1 октября 03:00 во Владивостоке.
    const deps = setup(new Date('2026-09-30T17:00:00Z'));

    await deps.repository.saveMeter({ id: 'm-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await deps.repository.saveReading({
      id: 'r-1',
      meterId: 'm-1',
      value: 120,
      at: new Date('2026-09-20T02:00:00Z'),
      submittedBy: maria.id,
    });

    const result = await submitReading(deps, { resident: maria, meterId: 'm-1', value: 126 });

    assert.equal(result.reading.value, 126, 'сентябрьское показание не мешает октябрьскому');
  });

  it('утренняя сводка уходит по местному утру', async () => {
    // 23:30 UTC это 09:30 следующего дня во Владивостоке: утро уже наступило.
    const morning = setup(new Date('2026-09-20T23:30:00Z'));
    const kept = store();

    await morning.repository.saveResident({ ...dispatcher, onDuty: true });
    await submitProblem(morning, { resident: maria, description: 'Течёт кран на кухне' });

    await createSweeper(morning, { store: kept }).run();

    assert.equal(typeof kept.state.houses?.[BUILDING_ID]?.digest, 'string', 'по местным часам сводка ушла');

    // 03:00 UTC это 13:00 по Москве, но всего 10:00 предыдущего дня во Владивостоке.
    const night = setup(new Date('2026-09-20T18:00:00Z'));
    const fresh = store();

    await createSweeper(night, { store: fresh, digestHour: 8 }).run();

    assert.equal(fresh.state.houses?.[BUILDING_ID]?.digest, undefined, 'до местного утра сводки нет');
  });

  it('в обращении в жилинспекцию стоят местные отметки времени', async () => {
    const deps = setup(new Date('2026-09-22T10:00:00Z'));

    const created = await submitProblem(deps, {
      resident: maria,
      description: 'Не горит лампа на площадке',
      startParam: `ent_${BUILDING_ID}_1`,
    });

    if (created.kind !== 'created') throw new Error('заявка не завелась');

    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });

    const late = { ...deps, now: () => new Date('2026-09-30T10:00:00Z') };
    const offer = await escalationFor(late, maria, created.request.id);

    assert.equal(offer.possible, true, `срок должен быть нарушен: ${offer.reason}`);
    assert.match(offer.complaint ?? '', /22\.09\.2026, 20:00/, 'время дома, а не московское');
  });
});
