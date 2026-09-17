import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createServiceRequest,
  createSweeper,
  type Notification,
  type Repository,
  type Resident,
  type SweepState,
  type SweepStore,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-20T09:00:00Z');
const HOUR = 60 * 60 * 1000;

const DISPATCHER: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const IVAN: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const store = (initial: SweepState = {}): SweepStore & { state: SweepState } => {
  const kept = { state: initial };

  return {
    get state() {
      return kept.state;
    },
    load: async () => kept.state,
    save: async (next: SweepState) => void (kept.state = next),
  };
};

/** Тот же репозиторий, но один метод падает. */
const breaking = (repository: Repository, method: keyof Repository): Repository =>
  Object.assign(Object.create(Object.getPrototypeOf(repository) as object) as Repository, repository, {
    [method]: () => Promise.reject(new Error('база недоступна')),
  });

const setup = async () => {
  const repository = new InMemoryRepository();
  const sent: Notification[] = [];
  let clock = NOW.getTime();
  let counter = 0;

  await repository.saveBuilding({ id: BUILDING_ID, code: 'Д1', address: 'ул. Ленина, 1', managementCompany: 'УК' });
  await repository.saveApartment({ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 40 });

  for (const person of [DISPATCHER, IVAN]) await repository.saveResident(person);

  const deps = {
    repository: repository as Repository,
    now: () => new Date(clock),
    createId: () => `id-${(counter += 1)}`,
    defaultBuildingId: BUILDING_ID,
    notifier: {
      async send(notification: Notification) {
        sent.push(notification);
      },
    },
  };

  return {
    deps,
    sent,
    at: (hours: number) => void (clock = NOW.getTime() + hours * HOUR),
    /** Заявка, срок которой истёк внутри окна проверки. */
    overdue: async () => {
      clock = NOW.getTime() - 30 * HOUR;
      await createServiceRequest(deps, { resident: IVAN, description: 'Течёт кран на кухне' });
      clock = NOW.getTime();
    },
  };
};

const since = (): SweepState => ({ checkedUntil: new Date(NOW.getTime() - 30 * HOUR).toISOString() });

describe('регулярный обход', () => {
  it('сдвигает окно только после удачного прохода', async () => {
    const { deps, overdue } = await setup();
    const kept = store(since());
    const opened = kept.state.checkedUntil;

    await overdue();

    const failed = await createSweeper({ ...deps, repository: breaking(deps.repository, 'listRequests') }, {
      store: kept,
    }).run();

    assert.equal(failed.failures.length > 0, true, 'ошибка названа');
    assert.equal(kept.state.checkedUntil, opened, 'окно не сдвинулось');

    const report = await createSweeper(deps, { store: kept }).run();

    assert.equal(report.overdue, 1, 'нарушенный срок дошёл со следующей попытки');
    assert.notEqual(kept.state.checkedUntil, opened);
  });

  it('суточное напоминание не сгорает из-за ошибки', async () => {
    const { deps } = await setup();
    const kept = store();

    await createSweeper({ ...deps, repository: breaking(deps.repository, 'listResidentsByApartments') }, { store: kept }).run();

    assert.equal(kept.state.houses?.[BUILDING_ID]?.debt, undefined, 'день не отмечен');

    await createSweeper(deps, { store: kept }).run();

    assert.equal(typeof kept.state.houses?.[BUILDING_ID]?.debt, 'string', 'отметка ставится после удачной рассылки');
  });

  it('ночью суточные напоминания не уходят, утром уходят', async () => {
    const { deps, at, sent } = await setup();
    const kept = store();

    // Три часа ночи по времени дома: показания, собрания и долг ждут утра.
    at(-9);

    const night = await createSweeper(deps, { store: kept }).run();

    assert.equal(night.readings + night.pollReminders + night.debtors, 0, 'ночью никого не будим');
    assert.equal(kept.state.houses?.[BUILDING_ID]?.debt, undefined, 'день не отмечен');
    assert.equal(sent.length, 0);

    at(0);
    await createSweeper(deps, { store: kept }).run();

    assert.equal(typeof kept.state.houses?.[BUILDING_ID]?.debt, 'string', 'утром напоминание ушло');
  });

  it('второй запуск не идёт поверх первого', async () => {
    const { deps, overdue } = await setup();

    await overdue();

    const sweeper = createSweeper(deps, { store: store(since()) });
    const [first, second] = await Promise.all([sweeper.run(), sweeper.run()]);

    assert.equal(first, second, 'оба ждут один проход');
    assert.equal(first?.overdue, 1, 'о сроке сказали один раз');
  });

  it('отметки прошлого дня не мешают сегодняшним', async () => {
    const { deps, at } = await setup();
    const kept = store();

    await createSweeper(deps, { store: kept }).run();

    const yesterday = kept.state.houses?.[BUILDING_ID]?.debt;

    at(24);
    await createSweeper(deps, { store: kept }).run();

    assert.notEqual(kept.state.houses?.[BUILDING_ID]?.debt, yesterday);
  });
});
