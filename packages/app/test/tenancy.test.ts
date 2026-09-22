import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  closePoll,
  commentRequest,
  contactForRequest,
  createCollectingNotifier,
  createServiceRequest,
  getRequestFor,
  houseMetersFor,
  listPeople,
  listUnbound,
  pollProtocol,
  remindDebtor,
  setDuty,
  startPoll,
  submitHouseReading,
  transitionRequest,
  vote,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

/** Две управляющие организации на одной установке. */
const OURS = 'b1';
const THEIRS = 'b2';

const APARTMENTS = [
  { id: 'apt-1', buildingId: OURS, number: 1, entrance: 1, riser: 1, area: 50, residents: 2 },
  { id: 'apt-2', buildingId: THEIRS, number: 2, entrance: 1, riser: 1, area: 60, residents: 2 },
];

const ourDispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: OURS,
};

const ourManager: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Нина',
  role: 'manager',
  buildingId: OURS,
};

const theirManager: Resident = {
  id: 'mgr-2',
  maxUserId: 7008,
  displayName: 'Пётр',
  role: 'manager',
  buildingId: THEIRS,
};

const theirDispatcher: Resident = {
  id: 'disp-2',
  maxUserId: 5006,
  displayName: 'Анна',
  role: 'dispatcher',
  buildingId: THEIRS,
};

const theirResident: Resident = {
  id: 'res-2',
  maxUserId: 1002,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-2',
  apartmentIds: ['apt-2'],
  buildingId: THEIRS,
};

const contractor: Resident = {
  id: 'con-1',
  maxUserId: 2004,
  displayName: 'Лифтсервис',
  role: 'contractor',
  buildingId: OURS,
};

const newcomer: Resident = {
  id: 'res-new',
  maxUserId: 1009,
  displayName: 'Новичок',
  role: 'resident',
  buildingId: THEIRS,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> };

const setup = (): Deps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [
        { id: OURS, code: 'Д15', address: 'ул. Ленина, 15', companyId: 'ук-первая' },
        { id: THEIRS, code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' },
      ],
      apartments: APARTMENTS,
      residents: [ourDispatcher, ourManager, theirManager, theirDispatcher, theirResident, contractor, newcomer],
    }),
    now: () => new Date('2026-09-22T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: OURS,
    notifier: createCollectingNotifier(),
  };
};

/** Заявка в доме другой организации. */
const theirRequest = async (deps: Deps) =>
  createServiceRequest(deps, { resident: theirResident, description: 'Течёт кран на кухне' });

describe('граница управляющей организации', () => {
  it('чужую заявку не открыть по её идентификатору', async () => {
    const deps = setup();
    const request = await theirRequest(deps);

    await assert.rejects(getRequestFor(deps, ourDispatcher, request.id), /другая управляющая организация/);
  });

  it('чужую заявку не перевести и не прокомментировать', async () => {
    const deps = setup();
    const request = await theirRequest(deps);

    await assert.rejects(
      transitionRequest(deps, { resident: ourDispatcher, requestId: request.id, to: 'accepted' }),
      /другая управляющая организация/,
    );

    await assert.rejects(
      commentRequest(deps, { resident: ourDispatcher, requestId: request.id, text: 'Смотрим' }),
      /другая управляющая организация/,
    );
  });

  it('телефон автора чужой заявки не отдаётся', async () => {
    const deps = setup();
    const request = await theirRequest(deps);

    await assert.rejects(contactForRequest(deps, ourDispatcher, request.id), /другая управляющая организация/);
  });

  it('напоминание о долге чужому жильцу не уходит', async () => {
    const deps = setup();

    await assert.rejects(remindDebtor(deps, ourManager, theirResident.id), /другая управляющая организация/);
    assert.deepEqual(deps.notifier.sent, []);
  });

  it('протокол чужого собрания не читается', async () => {
    const deps = setup();
    const poll = await startPoll(deps, {
      resident: theirManager,
      kind: 'simple',
      title: 'Ремонт крыльца',
      question: 'Утвердить смету',
      days: 1,
    });

    await deps.repository.savePoll({ ...poll, closedAt: deps.now() });

    await assert.rejects(pollProtocol(deps, ourManager, poll.id), /другая управляющая организация/);
    assert.match(await pollProtocol(deps, theirManager, poll.id), /Протокол/);
  });

  it('непривязанные жильцы чужих домов в списке не видны', async () => {
    const deps = setup();

    assert.deepEqual(
      (await listUnbound(deps, ourManager)).map((person) => person.displayName),
      [],
    );

    assert.deepEqual(
      (await listUnbound(deps, theirManager)).map((person) => person.displayName),
      ['Новичок'],
    );
  });

  it('дежурство чужому сотруднику не назначить', async () => {
    const deps = setup();

    await assert.rejects(
      setDuty(deps, ourManager, { residentId: theirDispatcher.id, onDuty: true }),
      /другая управляющая организация/,
    );
  });

  it('показание чужого узла учёта не принять', async () => {
    const deps = setup();

    await deps.repository.saveHouseMeter({
      id: 'hm-1',
      buildingId: THEIRS,
      kind: 'cold_water',
      serial: 'ОДПУ-1',
    });

    await assert.rejects(
      submitHouseReading(deps, ourDispatcher, { meterId: 'hm-1', value: 100 }),
      /другая управляющая организация/,
    );

    const accepted = await submitHouseReading(deps, theirDispatcher, { meterId: 'hm-1', value: 100 });

    assert.equal(accepted.reading.value, 100);
    assert.equal((await houseMetersFor(deps, theirDispatcher)).length, 1);
  });
});

describe('подрядчик не управляющая организация', () => {
  it('список людей дома ему не отдают', async () => {
    const deps = setup();

    await assert.rejects(listPeople(deps, contractor), /доступен управляющей организации/);
  });

  it('дежурство он не назначает', async () => {
    const deps = setup();

    await assert.rejects(
      setDuty(deps, contractor, { residentId: ourDispatcher.id, onDuty: true }),
      /назначает диспетчер или управляющий/,
    );
  });
});

describe('голос после подведения итогов', () => {
  it('не принимается, даже если срок ещё не вышел', async () => {
    const deps = setup();
    const poll = await startPoll(deps, {
      resident: theirManager,
      kind: 'simple',
      title: 'Ремонт крыльца',
      question: 'Утвердить смету',
      days: 14,
    });

    await closePoll(deps, poll);

    await assert.rejects(
      vote(deps, { resident: theirResident, pollId: poll.id, choice: 'for' }),
      /Итоги подведены/,
    );
  });
});
