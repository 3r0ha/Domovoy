import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError, ELDER_TERM_YEARS } from '@domovoy/domain';

import {
  asRequest,
  InMemoryRepository,
  closeDuePolls,
  commentRequest,
  createCollectingNotifier,
  elderOf,
  isElder,
  startElderPoll,
  submitProblem,
  transitionRequest,
  vote,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const START = new Date('2026-09-01T10:00:00Z');
const DAY = 24 * 3600_000;

/** Два подъезда по две квартиры: у старшего первого подъезда во втором прав нет. */
const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-20', buildingId: BUILDING_ID, number: 20, entrance: 2, riser: 1, area: 50 },
  { id: 'apt-21', buildingId: BUILDING_ID, number: 21, entrance: 2, riser: 1, area: 50 },
];

const resident = (id: string, apartmentId: string, maxUserId: number): Resident => ({
  id,
  maxUserId,
  displayName: `Житель ${id}`,
  role: 'resident',
  apartmentId,
  buildingId: BUILDING_ID,
  owned: [{ apartmentId, share: 1, basis: 'company' }],
});

const maria = resident('res-1', 'apt-1', 1001);
const ivan = resident('res-2', 'apt-2', 1002);
const anna = resident('res-3', 'apt-20', 1003);
const oleg = resident('res-4', 'apt-21', 1004);

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier>; advance: (ms: number) => void };

const setup = (): Deps => {
  let counter = 0;
  let clock = START.getTime();

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: APARTMENTS,
      residents: [maria, ivan, anna, oleg, dispatcher],
    }),
    now: () => new Date(clock),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
    advance: (ms: number) => {
      clock += ms;
    },
  };
};

/** Выбирает Марию старшей первого подъезда: голосуют все четыре квартиры. */
const elect = async (deps: Deps): Promise<void> => {
  const poll = await startElderPoll(deps, { resident: dispatcher, candidateId: maria.id, days: 14 });

  for (const voter of [maria, ivan, anna]) {
    await vote(deps, { resident: voter, pollId: poll.id, choice: 'for' });
  }

  deps.advance(15 * DAY);
  await closeDuePolls(deps);
};

describe('старший по подъезду', () => {
  it('выбирается собранием, а не назначается', async () => {
    const deps = setup();
    const poll = await startElderPoll(deps, { resident: dispatcher, candidateId: maria.id, days: 14 });

    assert.match(poll.title, /Старший по подъезду 1/);
    assert.equal(poll.elder?.entrance, 1, 'подъезд взят из квартиры кандидата');
    assert.equal(await elderOf(deps, BUILDING_ID, 1), undefined);

    await elect(deps);

    assert.equal((await elderOf(deps, BUILDING_ID, 1))?.residentId, maria.id);
    assert.equal(await isElder(deps, maria), true);
    assert.equal(await isElder(deps, ivan), false);
  });

  it('не выбранный собранием старшим не становится', async () => {
    const deps = setup();
    const poll = await startElderPoll(deps, { resident: dispatcher, candidateId: maria.id, days: 14 });

    for (const voter of [maria, ivan, anna]) {
      await vote(deps, { resident: voter, pollId: poll.id, choice: 'against' });
    }

    deps.advance(15 * DAY);
    await closeDuePolls(deps);

    assert.equal(await elderOf(deps, BUILDING_ID, 1), undefined);
  });

  it('полномочия срочные', async () => {
    const deps = setup();

    await elect(deps);

    const eldership = await elderOf(deps, BUILDING_ID, 1);

    assert.equal(eldership?.until.getUTCFullYear(), START.getUTCFullYear() + ELDER_TERM_YEARS);

    deps.advance(ELDER_TERM_YEARS * 366 * DAY);
    assert.equal(await elderOf(deps, BUILDING_ID, 1), undefined);
    assert.equal(await isElder(deps, maria), false);
  });

  it('принимает работу по общему имуществу своего подъезда', async () => {
    const deps = setup();

    await elect(deps);

    const created = asRequest(await submitProblem(deps, {
      resident: ivan,
      description: 'Не горит лампа на площадке',
      startParam: 'ent_b1_1',
    }));
    const id = created.request.id;

    await transitionRequest(deps, { resident: dispatcher, requestId: id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: id,
      to: 'in_progress',
      assigneeId: dispatcher.id,
    });
    await transitionRequest(deps, { resident: dispatcher, requestId: id, to: 'done', comment: 'Заменил лампу' });

    const confirmed = await transitionRequest(deps, { resident: maria, requestId: id, to: 'confirmed' });

    assert.equal(confirmed.status, 'confirmed');
  });

  it('пока старшего нет, за подъезд не расписывается никто', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, {
      resident: ivan,
      description: 'Не горит лампа на площадке',
      startParam: 'ent_b1_1',
    }));

    await assert.rejects(
      commentRequest(deps, { resident: maria, requestId: created.request.id, text: 'Я разберусь' }),
      DomainError,
    );
  });

  it('в чужой подъезд полномочия не достают', async () => {
    const deps = setup();

    await elect(deps);

    const created = asRequest(await submitProblem(deps, {
      resident: anna,
      description: 'Не горит лампа на площадке',
      startParam: 'ent_b1_2',
    }));

    await assert.rejects(
      commentRequest(deps, { resident: maria, requestId: created.request.id, text: 'Я разберусь' }),
      DomainError,
    );
  });

  it('узнаёт о заявках своего подъезда, даже если завёл их не он', async () => {
    const deps = setup();

    await elect(deps);

    const created = asRequest(await submitProblem(deps, {
      resident: ivan,
      description: 'Не горит лампа на площадке',
      startParam: 'ent_b1_1',
    }));

    deps.notifier.sent.length = 0;
    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });

    assert.equal(
      deps.notifier.sent.some((message) => message.maxUserId === maria.maxUserId),
      true,
    );
  });

  it('старшим выбирают собственника помещения, а не любого человека', async () => {
    const deps = setup();

    await assert.rejects(
      startElderPoll(deps, { resident: dispatcher, candidateId: dispatcher.id, days: 14 }),
      /собственника помещения/,
    );
  });

  it('сотрудник, живущий в подъезде, в кандидаты годится', async () => {
    const deps = setup();

    await deps.repository.saveResident({ ...dispatcher, apartmentId: 'apt-2', apartmentIds: ['apt-2'] });

    const poll = await startElderPoll(deps, { resident: dispatcher, candidateId: dispatcher.id, days: 14 });

    assert.match(poll.title, /Старший по подъезду 1/);
  });
});
