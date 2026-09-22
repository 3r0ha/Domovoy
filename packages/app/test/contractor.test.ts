import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createCollectingNotifier,
  createMockHub,
  createServiceRequest,
  devicesFor,
  getRequestFor,
  journalFor,
  sensorsFor,
  housePlan,
  listAssignable,
  listRequestsFor,
  transitionRequest,
  buildingReport,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-07T10:00:00Z');

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const lifts: Resident = {
  id: 'con-1',
  maxUserId: 9009,
  displayName: 'Лифтсервис',
  role: 'contractor',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> };

const setup = (): Deps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
      ],
      residents: [maria, dispatcher, lifts],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
    hub: createMockHub({
      now: () => NOW,
      devices: [{ id: 'door-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон', entrance: 1 }],
    }),
  };
};

const assignedLift = async (deps: Deps) => {
  const request = await createServiceRequest(deps, { resident: maria, description: 'Лифт застрял между этажами' });

  await transitionRequest(deps, {
    resident: dispatcher,
    requestId: request.id,
    to: 'accepted',
    assigneeId: lifts.id,
  });

  return request;
};

describe('подрядчик', () => {
  it('видит только порученное ему', async () => {
    const deps = setup();

    const mine = await assignedLift(deps);
    const other = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    const list = await listRequestsFor(deps, lifts, 'mine');

    assert.deepEqual(
      list.map((request) => request.id),
      [mine.id],
    );
    await assert.rejects(getRequestFor(deps, lifts, other.id), /не ваша/);
  });

  it('очередь дома ему не открывается', async () => {
    const deps = setup();

    await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    assert.deepEqual(await listRequestsFor(deps, lifts, 'queue'), []);
  });

  it('ведёт свой наряд до сдачи работы', async () => {
    const deps = setup();
    const request = await assignedLift(deps);

    const started = await transitionRequest(deps, { resident: lifts, requestId: request.id, to: 'in_progress' });
    const done = await transitionRequest(deps, {
      resident: lifts,
      requestId: started.id,
      to: 'done',
      comment: 'Заменил тросы',
    });

    assert.equal(done.status, 'done');
  });

  it('чужой наряд перевести не может', async () => {
    const deps = setup();

    const other = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    await transitionRequest(deps, { resident: dispatcher, requestId: other.id, to: 'accepted' });

    await assert.rejects(
      transitionRequest(deps, { resident: lifts, requestId: other.id, to: 'in_progress' }),
      /не найдена/,
    );
  });

  it('внутренние инструменты компании ему закрыты', async () => {
    const deps = setup();

    await assert.rejects(housePlan(deps, lifts), /управляющая организация/);
    await assert.rejects(buildingReport(deps, lifts), /управляющей организации/);
    await assert.rejects(listAssignable(deps, lifts), /управляющая организация/);
  });

  it('двери и журнал дома ему не принадлежат', async () => {
    const deps = setup();

    assert.deepEqual(await devicesFor(deps, lifts, 1), []);
    assert.deepEqual(await journalFor(deps, lifts), []);
    assert.deepEqual(await sensorsFor(deps, lifts), []);
  });

  it('узнаёт о наряде сам, не открывая приложение', async () => {
    const deps = setup();

    deps.notifier.sent.length = 0;
    await assignedLift(deps);

    const sent = deps.notifier.sent.filter((item) => item.maxUserId === lifts.maxUserId);

    assert.equal(sent.length, 1);
    assert.match(sent[0]?.text ?? '', /Вам поручена заявка/);
    assert.match(sent[0]?.text ?? '', /Срок:/);
  });

  it('при передаче другому прежний исполнитель узнаёт об этом', async () => {
    const deps = setup();
    const request = await assignedLift(deps);

    const other: Resident = { ...lifts, id: 'con-2', maxUserId: 9010, displayName: 'Лифтремонт' };

    await deps.repository.saveResident(other);
    deps.notifier.sent.length = 0;

    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'in_progress',
      assigneeId: other.id,
    });

    const toOld = deps.notifier.sent.find((item) => item.maxUserId === lifts.maxUserId);
    const toNew = deps.notifier.sent.find((item) => item.maxUserId === other.maxUserId);

    assert.match(toOld?.text ?? '', /передана другому исполнителю/);
    assert.match(toNew?.text ?? '', /Вам поручена заявка/);
  });

  it('рассылки по дому его не касаются, а поручить работу ему можно', async () => {
    const deps = setup();

    deps.notifier.sent.length = 0;
    await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    assert.equal(deps.notifier.sent.some((item) => item.maxUserId === lifts.maxUserId), false);
    assert.equal(
      (await listAssignable(deps, dispatcher)).some((person) => person.id === lifts.id),
      true,
    );
  });
});
