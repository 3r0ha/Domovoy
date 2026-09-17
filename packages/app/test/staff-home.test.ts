import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  bindApartment,
  escalationFor,
  submitProblem,
  chargesForResident,
  createCollectingNotifier,
  createMockHub,
  devicesFor,
  houseNow,
  houseQuality,
  listAnnouncementsFor,
  listPollsFor,
  listServedBuildings,
  publishAnnouncement,
  startPoll,
  useApartment,
  vote,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

/** Сотрудник работает в Д15, а живёт в Д17: дом смены и дом жизни у него разные. */
const WORK = 'b1';
const HOME = 'b2';

const APARTMENTS = [
  { id: 'apt-1', buildingId: WORK, number: 1, entrance: 1, riser: 1, area: 50, residents: 2 },
  { id: 'apt-17', buildingId: HOME, code: 'ACEFHK34', number: 17, entrance: 1, riser: 1, area: 60, residents: 2 },
  { id: 'apt-18', buildingId: HOME, number: 18, entrance: 1, riser: 1, area: 40, residents: 1 },
];

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  apartmentId: 'apt-17',
  apartmentIds: ['apt-17'],
  buildingId: WORK,
};

const neighbour: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-18',
  apartmentIds: ['apt-18'],
  buildingId: HOME,
};

const manager: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Управляющий',
  role: 'manager',
  buildingId: WORK,
};

/** Дом, где сотрудник живёт, обслуживает другая организация. */
const theirManager: Resident = {
  id: 'mgr-2',
  maxUserId: 7008,
  displayName: 'Управляющий Д17',
  role: 'manager',
  buildingId: HOME,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> };

const setup = (residents: Resident[] = [dispatcher, neighbour, manager, theirManager]): Deps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [
        { id: WORK, code: 'Д15', address: 'ул. Ленина, 15' },
        { id: HOME, code: 'Д17', address: 'ул. Ленина, 17', companyId: 'ук-вторая' },
      ],
      apartments: APARTMENTS,
      residents,
    }),
    now: () => new Date('2026-09-22T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: WORK,
    notifier: createCollectingNotifier(),
  };
};

describe('сотрудник, который живёт в другом доме', () => {
  it('видит у себя дома то, что происходит там, а не на смене', async () => {
    const deps = setup();

    await publishAnnouncement(deps, {
      resident: manager,
      title: 'Работы в доме смены',
      body: 'Стояк 1',
      entrance: 1,
      riser: 1,
      works: {
        category: 'plumbing',
        from: new Date('2026-09-22T08:00:00Z'),
        until: new Date('2026-09-22T14:00:00Z'),
      },
    });

    const now = await houseNow(deps, dispatcher);

    assert.deepEqual(
      now.works.map((work) => work.title),
      [],
      'работы идут в доме смены, а живёт он в другом',
    );

    const quality = await houseQuality(deps, dispatcher);

    assert.equal(quality.buildingId, HOME, 'работу компании он смотрит по своему дому');
  });

  it('получает объявления своего дома и ленту дома смены', async () => {
    const deps = setup();
    await publishAnnouncement(deps, {
      resident: manager,
      title: 'Уборка в доме смены',
      body: 'Завтра',
    });

    await deps.repository.saveAnnouncement({
      id: 'ann-home',
      buildingId: HOME,
      title: 'Отключение в моём доме',
      body: 'До вечера',
      audience: { kind: 'building' },
      recipientIds: ['apt-17', 'apt-18'],
      createdAt: new Date('2026-09-22T09:00:00Z'),
    });

    const news = await listAnnouncementsFor(deps, dispatcher);

    assert.deepEqual(
      news.map((item) => item.title).sort(),
      ['Отключение в моём доме', 'Уборка в доме смены'],
    );
  });

  it('голосует на собрании своего дома, а не того, где работает', async () => {
    const deps = setup();

    const poll = await startPoll(deps, {
      resident: theirManager,
      kind: 'simple',
      title: 'Ремонт крыльца',
      question: 'Утвердить смету',
      days: 7,
    });

    assert.deepEqual(
      (await listPollsFor(deps, dispatcher)).map((view) => view.poll.title),
      ['Ремонт крыльца'],
    );

    const view = await vote(deps, { resident: dispatcher, pollId: poll.id, choice: 'for' });

    assert.equal(view.myChoice, 'for');
  });

  it('видит собрания и своего дома, и дома смены', async () => {
    const deps = setup();

    const home = await startPoll(deps, {
      resident: theirManager,
      kind: 'simple',
      title: 'Крыльцо в моём доме',
      question: 'Утвердить смету',
      days: 7,
    });

    const work = await startPoll(deps, {
      resident: manager,
      kind: 'simple',
      title: 'Ремонт лифта на смене',
      question: 'Утвердить смету',
      days: 7,
    });

    assert.deepEqual(
      (await listPollsFor(deps, dispatcher)).map((view) => view.poll.title).sort(),
      ['Крыльцо в моём доме', 'Ремонт лифта на смене'],
    );

    assert.deepEqual(
      (await listPollsFor(deps, (await deps.repository.findResident(neighbour.id))!)).map((view) => view.poll.id),
      [home.id],
      'жильцу только его дом',
    );

    assert.equal(work.buildingId, WORK);
  });

  it('переключение на свою квартиру не переносит смену в чужую организацию', async () => {
    const deps = setup();
    const saved = await useApartment(deps, { ...dispatcher, apartmentId: 'apt-1', apartmentIds: ['apt-1', 'apt-17'] }, 'apt-17');

    assert.equal(saved.buildingId, WORK, 'смена остаётся в своём доме');

    assert.deepEqual(
      (await listServedBuildings(deps, saved)).map((building) => building.code),
      ['Д15'],
      'дома чужой организации ему по-прежнему не видны',
    );
  });

  it('квитанция считается по своей квартире, а не по дому смены', async () => {
    const deps = setup();

    await deps.repository.saveTariff({
      buildingId: HOME,
      kind: 'maintenance',
      value: 30,
      since: new Date('2026-01-01T00:00:00Z'),
    });

    const charges = await chargesForResident(deps, dispatcher);

    assert.equal(charges.lines.length > 0, true, 'начисления берутся из тарифов дома, где квартира');
  });

  it('открывает и свой домофон, и оборудование дома смены', async () => {
    const hub = createMockHub({
      devices: [
        { id: 'dev-work', buildingId: WORK, title: 'Домофон Д15', kind: 'intercom', entrance: 1 },
        { id: 'dev-home', buildingId: HOME, title: 'Домофон Д17', kind: 'intercom', entrance: 1 },
      ],
      now: () => new Date('2026-09-22T10:00:00Z'),
    });

    const deps = { ...setup(), hub };

    assert.deepEqual(
      (await devicesFor(deps, dispatcher, 1)).map((device) => device.id).sort(),
      ['dev-home', 'dev-work'],
    );

    assert.deepEqual(
      (await devicesFor(deps, (await deps.repository.findResident(neighbour.id))!, 1)).map((device) => device.id),
      ['dev-home'],
      'жильцу только свой дом',
    );
  });

  it('привязка квартиры сотрудником не переносит его смену в тот дом', async () => {
    const deps = setup([{ ...dispatcher, apartmentId: undefined, apartmentIds: [] }, manager, theirManager]);
    const staff = (await deps.repository.findResident(dispatcher.id))!;

    const bound = await bindApartment(deps, staff, 'ACEFHK34');

    assert.equal(bound.resident.apartmentId, 'apt-17');
    assert.equal(bound.resident.buildingId, WORK);
  });

  it('уведомление называет дом, когда домов у человека больше одного', async () => {
    const deps = setup();
    const owner = await deps.repository.saveResident({
      ...(await deps.repository.findResident(neighbour.id))!,
      apartmentIds: ['apt-18', 'apt-1'],
    });

    deps.notifier.sent.length = 0;

    await publishAnnouncement(deps, {
      resident: theirManager,
      title: 'Отключение воды',
      body: 'До 14:00',
    });

    const toOwner = deps.notifier.sent.find((message) => message.maxUserId === owner.maxUserId);
    const toStaff = deps.notifier.sent.find((message) => message.maxUserId === dispatcher.maxUserId);

    assert.match(toOwner?.text ?? '', /Отключение воды\nул\. Ленина, 17/);
    assert.match(toStaff?.text ?? '', /Отключение воды\nул\. Ленина, 17/, 'у сотрудника дом смены другой');
  });

  it('на свою же работу сотрудник в жилинспекцию не жалуется, а на чужой дом жалуется', async () => {
    const deps = setup();
    const staff = (await deps.repository.findResident(dispatcher.id))!;

    const home = await submitProblem(deps, { resident: staff, description: 'Не работает лифт в моём подъезде' });
    const work = await submitProblem(deps, {
      resident: staff,
      description: 'Не горит лампа на площадке',
      startParam: `ent_${WORK}_1`,
    });

    if (home.kind !== 'created' || work.kind !== 'created') throw new Error('заявки не завелись');

    assert.equal(home.request.buildingId, HOME);
    assert.equal(work.request.buildingId, WORK);

    const onWork = await escalationFor(deps, staff, work.request.id);

    assert.equal(onWork.possible, false);
    assert.match(onWork.reason ?? '', /управляющая компания/);

    const onHome = await escalationFor(deps, staff, home.request.id);

    assert.equal(onHome.possible, false, 'срок ещё не нарушен');
    assert.doesNotMatch(onHome.reason ?? '', /управляющая компания/, 'свой дом обслуживает не он');
  });
});
