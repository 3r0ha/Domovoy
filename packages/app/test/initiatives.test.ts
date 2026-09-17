import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '@domovoy/domain';

import {
  InMemoryRepository,
  callMeeting,
  createCollectingNotifier,
  listInitiativesFor,
  startInitiative,
  supportInitiative,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const START = new Date('2026-09-01T10:00:00Z');

/** 200 м² на дом: требование о собрании начинается с двадцати подписанных метров. */
const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 10 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 5 },
  { id: 'apt-3', buildingId: BUILDING_ID, number: 3, entrance: 1, riser: 1, area: 100 },
  { id: 'apt-4', buildingId: BUILDING_ID, number: 4, entrance: 1, riser: 2, area: 85 },
];

const resident = (id: string, apartmentId: string, maxUserId: number): Resident => ({
  id,
  maxUserId,
  displayName: `Житель ${id}`,
  role: 'resident',
  apartmentId,
  buildingId: BUILDING_ID,
});

const maria = resident('res-1', 'apt-1', 1001);
const ivan = resident('res-2', 'apt-2', 1002);
const anna = resident('res-3', 'apt-3', 1003);

const manager: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Управляющий',
  role: 'manager',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> };

const setup = (): Deps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: APARTMENTS,
      residents: [maria, ivan, anna, manager],
    }),
    now: () => START,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
  };
};

const propose = (deps: Deps, author: Resident = maria) =>
  startInitiative(deps, {
    resident: author,
    title: 'Шлагбаум во двор',
    question: 'Поставить шлагбаум на въезд со стороны улицы',
  });

describe('инициатива жильцов', () => {
  it('автор подписывает своё предложение, соседи о нём узнают', async () => {
    const deps = setup();
    const initiative = await propose(deps);

    assert.deepEqual(
      initiative.signatures.map((signature) => signature.apartmentId),
      ['apt-1'],
    );
    assert.deepEqual(
      deps.notifier.sent.map((message) => message.maxUserId).sort(),
      [ivan.maxUserId, anna.maxUserId].sort(),
    );
    assert.match(deps.notifier.sent[0]?.text ?? '', /Шлагбаум во двор/);
    assert.equal(deps.notifier.sent[0]?.signAbout, initiative.id);
  });

  it('подписи весят площадью, а не числом голов', async () => {
    const deps = setup();
    const initiative = await propose(deps);

    const [own] = await listInitiativesFor(deps, maria);

    assert.equal(own?.standing.share, 0.05);
    assert.equal(own?.standing.enough, false);
    assert.equal(own?.standing.areaToDemand, 10);

    const after = await supportInitiative(deps, { resident: anna, initiativeId: initiative.id });

    assert.equal(after.standing.enough, true, 'сто метров из двухсот, больше десятой части');
    assert.equal(after.signatures, 2);
  });

  it('дважды одна квартира не подписывается', async () => {
    const deps = setup();
    const initiative = await propose(deps);

    await supportInitiative(deps, { resident: ivan, initiativeId: initiative.id });
    const twice = await supportInitiative(deps, { resident: ivan, initiativeId: initiative.id });

    assert.equal(twice.signatures, 2);
  });

  it('управляющая компания узнаёт один раз, когда подписей стало достаточно', async () => {
    const deps = setup();
    const initiative = await propose(deps);

    deps.notifier.sent.length = 0;
    await supportInitiative(deps, { resident: ivan, initiativeId: initiative.id });

    assert.equal(deps.notifier.sent.length, 0, 'пятнадцати метров из двухсот для требования мало');

    await supportInitiative(deps, { resident: anna, initiativeId: initiative.id });

    assert.equal(deps.notifier.sent.length, 1);
    assert.equal(deps.notifier.sent[0]?.maxUserId, manager.maxUserId);
    assert.match(deps.notifier.sent[0]?.text ?? '', /требуют собрания/);

    deps.notifier.sent.length = 0;
    await supportInitiative(deps, { resident: maria, initiativeId: initiative.id });

    assert.deepEqual(deps.notifier.sent, []);
  });

  it('второе предложение того же жильца не заводится', async () => {
    const deps = setup();

    await propose(deps);

    await assert.rejects(propose(deps), /уже собирает подписи/);
  });

  it('собрание по инициативе объявляет управляющая компания, автор об этом узнаёт', async () => {
    const deps = setup();
    const initiative = await propose(deps);

    await supportInitiative(deps, { resident: anna, initiativeId: initiative.id });

    deps.notifier.sent.length = 0;
    const poll = await callMeeting(deps, { resident: manager, initiativeId: initiative.id, days: 14, kind: 'qualified' });

    assert.equal(poll.title, 'Шлагбаум во двор');
    assert.equal(poll.kind, 'qualified', 'порог выбирает тот, кто созывает собрание');

    const [view] = await listInitiativesFor(deps, maria);

    assert.equal(view?.initiative.pollId, poll.id);
    assert.equal(
      deps.notifier.sent.some(
        (message) => message.maxUserId === maria.maxUserId && /по вашему предложению/.test(message.text),
      ),
      true,
    );

    await assert.doesNotReject(propose(deps));
  });

  it('дважды собрание по одной инициативе не объявляют', async () => {
    const deps = setup();
    const initiative = await propose(deps);

    await callMeeting(deps, { resident: manager, initiativeId: initiative.id, days: 14 });

    await assert.rejects(
      callMeeting(deps, { resident: manager, initiativeId: initiative.id, days: 14 }),
      /уже объявлено/,
    );
  });

  it('жилец собрание не объявляет, а без квартиры не подписывает', async () => {
    const deps = setup();
    const initiative = await propose(deps);
    const guest: Resident = { id: 'res-9', maxUserId: 9009, displayName: 'Гость', role: 'resident' };

    await assert.rejects(
      callMeeting(deps, { resident: ivan, initiativeId: initiative.id, days: 14 }),
      DomainError,
    );
    await assert.rejects(supportInitiative(deps, { resident: guest, initiativeId: initiative.id }), DomainError);
  });
});
