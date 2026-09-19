import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  addHouseMeter,
  callMeeting,
  createCollectingNotifier,
  createServiceRequest,
  handoffsOf,
  houseDebt,
  houseMetersFor,
  listAnnouncementsFor,
  publishAnnouncement,
  startInitiative,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

/** Две организации на одной установке. */
const OURS = 'b1';
const THEIRS = 'b2';

const APARTMENTS = [
  { id: 'apt-1', buildingId: OURS, number: 1, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-2', buildingId: THEIRS, number: 2, entrance: 1, riser: 1, area: 50 },
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

const ourResident: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  apartmentIds: ['apt-1'],
  buildingId: OURS,
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
      residents: [ourDispatcher, ourManager, ourResident, theirResident, contractor],
    }),
    now: () => new Date('2026-09-22T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: OURS,
    notifier: createCollectingNotifier(),
  };
};

describe('адрес заявки за границей дома', () => {
  it('по своему дому заявка заводится', async () => {
    const created = await createServiceRequest(setup(), {
      resident: ourResident,
      description: 'Мусор во дворе',
      startParam: 'bld_b1',
    });

    assert.equal(created.buildingId, OURS);
  });

  it('кодом чужого дома заявку туда не завести: его смену будить нечем', async () => {
    await assert.rejects(
      createServiceRequest(setup(), {
        resident: ourResident,
        description: 'Мусор во дворе',
        startParam: 'bld_b2',
      }),
      /чужому дому/,
    );
  });

  it('общее имущество чужого дома закрыто и для смены', async () => {
    const deps = setup();

    await assert.rejects(
      createServiceRequest(deps, {
        resident: ourDispatcher,
        description: 'Не горит лампа',
        startParam: 'ent_b2_1',
      }),
      /чужому дому/,
    );

    await assert.rejects(
      createServiceRequest(deps, {
        resident: ourDispatcher,
        description: 'Лифт не едет',
        startParam: 'eqp_b2_lift-1',
      }),
      /чужому дому/,
    );
  });

  it('свою смену тот же код не останавливает', async () => {
    const created = await createServiceRequest(setup(), {
      resident: ourDispatcher,
      description: 'Не горит лампа',
      startParam: 'ent_b1_1',
    });

    assert.equal(created.buildingId, OURS);
  });
});

describe('объявления дома', () => {
  it('подрядчику идёт только то, что адресовано ему', async () => {
    const deps = setup();

    await publishAnnouncement(deps, {
      resident: ourManager,
      title: 'Отключение воды',
      body: 'Стояк 1, подъезд 1',
      entrance: 1,
      riser: 1,
    });

    assert.deepEqual(await listAnnouncementsFor(deps, contractor), []);

    assert.deepEqual(
      (await listAnnouncementsFor(deps, ourResident)).map((announcement) => announcement.title),
      ['Отключение воды'],
    );
  });
});

describe('дом в служебных разделах', () => {
  it('узел учёта чужого дома не читается и не заводится', async () => {
    const deps = setup();

    await assert.rejects(houseMetersFor(deps, ourDispatcher, THEIRS), /другая управляющая организация/);

    await assert.rejects(
      addHouseMeter(deps, ourManager, { kind: 'cold_water', serial: 'ОДПУ-1', buildingId: THEIRS }),
      /другая управляющая организация/,
    );
  });

  it('должники чужого дома не показываются', async () => {
    await assert.rejects(houseDebt(setup(), ourManager, THEIRS), /другая управляющая организация/);
  });

  it('собрание по чужой инициативе не созывается', async () => {
    const deps = setup();

    const initiative = await startInitiative(deps, {
      resident: theirResident,
      title: 'Шлагбаум во двор',
      question: 'Поставить шлагбаум',
    });

    await assert.rejects(
      callMeeting(deps, { resident: ourManager, initiativeId: initiative.id, days: 14 }),
      /другая управляющая организация/,
    );
  });

  it('переданные обращения читает тот, кому видна заявка', async () => {
    const deps = setup();

    const request = await createServiceRequest(deps, {
      resident: theirResident,
      description: 'Течёт кран на кухне',
    });

    await assert.rejects(handoffsOf(deps, request.id, ourDispatcher), /другая управляющая организация/);
    await assert.rejects(handoffsOf(deps, request.id, ourResident), /Заявка не найдена/);

    assert.deepEqual(await handoffsOf(deps, request.id, theirResident), []);
  });
});
