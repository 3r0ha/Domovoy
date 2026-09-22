import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '@domovoy/domain';

import {
  InMemoryRepository,
  announcementAudience,
  commentRequest,
  createCollectingNotifier,
  createServiceRequest,
  describeContext,
  ensureResident,
  getRequestFor,
  listAnnouncementsFor,
  listRequestsFor,
  publishAnnouncement,
  renameSelf,
  submitProblem,
  transitionRequest,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-03T10:00:00Z');

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
  { id: 'apt-3', buildingId: BUILDING_ID, number: 20, entrance: 2, riser: 1 },
];

const resident = (overrides: Partial<Resident> = {}): Resident => ({
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
  ...overrides,
});

const setup = (residents: Resident[] = []): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: APARTMENTS,
      residents,
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
  };
};

describe('профиль жильца', () => {
  it('создаётся один раз и переиспользуется', async () => {
    const deps = setup();

    const first = await ensureResident(deps, { maxUserId: 1001, displayName: 'Мария' });
    const second = await ensureResident(deps, { maxUserId: 1001, displayName: 'Мария Иванова' });

    assert.equal(first.id, second.id);
    assert.equal(second.displayName, 'Мария Иванова', 'имя подтягивается из MAX на каждом входе');
  });

  it('имя, заданное самим человеком, новым входом не перетирается', async () => {
    const deps = setup();

    await ensureResident(deps, { maxUserId: 1001, displayName: 'Мария' });
    await renameSelf(deps, await ensureResident(deps, { maxUserId: 1001, displayName: 'Мария' }), 'Маша');

    const again = await ensureResident(deps, { maxUserId: 1001, displayName: 'Мария Иванова' });

    assert.equal(again.displayName, 'Маша');
  });

  it('новому человеку дом не подставляется даже в установке с одним домом', async () => {
    const deps: AppDeps = {
      ...setup(),
      defaultBuildingId: 'дом-которого-нет',
    };

    const created = await ensureResident(deps, { maxUserId: 1001, displayName: 'Мария' });

    assert.equal(created.buildingId, undefined, 'дом появляется вместе с квартирой');
  });

  it('пришедший из чата дома получает дом этого чата', async () => {
    const created = await ensureResident(setup(), { maxUserId: 1001, displayName: 'Мария', buildingId: BUILDING_ID });

    assert.equal(created.buildingId, BUILDING_ID);
  });

  it('когда домов несколько, дом не выбирается за человека', async () => {
    const deps: AppDeps = {
      repository: new InMemoryRepository({
        buildings: [
          { id: BUILDING_ID, code: 'Д15' },
          { id: 'b2', code: 'Д16' },
        ],
        apartments: APARTMENTS,
        residents: [],
      }),
      now: () => NOW,
      createId: () => 'id-1',
      defaultBuildingId: 'дом-которого-нет',
    };

    const created = await ensureResident(deps, { maxUserId: 1001, displayName: 'Мария' });

    assert.equal(created.buildingId, undefined, 'приписать к случайному дому хуже, чем спросить');
  });
});

describe('адрес заявки', () => {
  it('код объекта важнее привязки жильца', async () => {
    const deps = setup();

    const created = await createServiceRequest(deps, {
      resident: resident(),
      description: 'Не работает лифт',
      startParam: 'eqp_b1_lift-2',
    });

    assert.deepEqual(created.target, { kind: 'equipment', buildingId: BUILDING_ID, equipmentId: 'lift-2' });
  });

  it('диспетчер заводит заявку от квартиры, из которой позвонили', async () => {
    const deps = setup();

    const created = await createServiceRequest(deps, {
      resident: resident({ id: 'disp-1', role: 'dispatcher', apartmentId: undefined }),
      description: 'Течёт кран',
      apartmentId: 'apt-2',
    });

    assert.deepEqual(created.target, { kind: 'apartment', apartmentId: 'apt-2', number: 2 });
  });

  it('чужую квартиру жилец в заявке не указывает', async () => {
    const deps = setup();

    await assert.rejects(
      createServiceRequest(deps, { resident: resident(), description: 'Течёт кран', apartmentId: 'apt-2' }),
      /управляющая организация этого дома/,
    );
  });

  it('сотрудник без адреса, квартиры и дома заявку не создаёт', async () => {
    const deps = setup();

    await assert.rejects(
      createServiceRequest(deps, {
        resident: resident({ id: 'disp-1', role: 'dispatcher', apartmentId: undefined, buildingId: undefined }),
        description: 'Что-то сломалось',
      }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'target_required');
        return true;
      },
    );
  });

  it('жилец без квартиры заявку не заводит, даже если дом в привязке остался', async () => {
    const deps = setup();

    for (const buildingId of [BUILDING_ID, undefined]) {
      await assert.rejects(
        createServiceRequest(deps, {
          resident: resident({ apartmentId: undefined, buildingId }),
          description: 'Не работает домофон в первом подъезде',
        }),
        (error: unknown) => {
          assert.ok(error instanceof DomainError);
          assert.equal(error.code, 'apartment_required');
          assert.match(error.message, /привяжите квартиру кодом из квитанции/);
          return true;
        },
      );
    }

    assert.equal((await deps.repository.listRequests({})).length, 0, 'заявка по дому целиком не завелась');
  });

  it('сотрудник без квартиры заводит заявку на дом смены', async () => {
    const deps = setup();

    const created = await createServiceRequest(deps, {
      resident: resident({ id: 'disp-1', role: 'dispatcher', apartmentId: undefined }),
      description: 'Не работает домофон в первом подъезде',
    });

    assert.equal(created.target.kind, 'building');
  });

  it('несуществующая квартира заявку не создаёт', async () => {
    const deps = setup();

    await assert.rejects(
      createServiceRequest(deps, {
        resident: resident({ id: 'disp-1', role: 'dispatcher', apartmentId: undefined, buildingId: undefined }),
        description: 'Течёт кран',
        apartmentId: 'apt-из-другого-дома',
      }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'apartment_unknown');
        return true;
      },
    );
  });

  it('испорченный код объекта не принимается', async () => {
    const deps = setup();

    await assert.rejects(
      createServiceRequest(deps, {
        resident: resident(),
        description: 'Течёт',
        startParam: 'мусор',
      }),
      /адрес заявки/,
    );
  });
});

describe('доступ к заявкам', () => {
  it('жилец видит свои заявки, сотрудник, очередь дома', async () => {
    const dispatcher = resident({ id: 'disp-1', maxUserId: 5005, role: 'dispatcher', apartmentId: undefined });
    const deps = setup([resident(), dispatcher]);

    await createServiceRequest(deps, { resident: resident(), description: 'Течёт кран' });

    assert.equal((await listRequestsFor(deps, resident(), 'mine')).length, 1);
    assert.equal((await listRequestsFor(deps, dispatcher, 'queue')).length, 1);
    assert.equal((await listRequestsFor(deps, dispatcher, 'mine')).length, 0, 'своих заявок у диспетчера нет');
  });

  it('очередь дома не копит закрытые заявки', async () => {
    const dispatcher = resident({ id: 'disp-1', maxUserId: 5005, role: 'dispatcher', apartmentId: undefined });
    const deps = setup([resident(), dispatcher]);

    const closed = await createServiceRequest(deps, { resident: resident(), description: 'Течёт кран' });
    await createServiceRequest(deps, { resident: resident(), description: 'Не работает лифт' });

    await transitionRequest(deps, { resident: dispatcher, requestId: closed.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: closed.id,
      to: 'rejected',
      comment: 'Это не общее имущество',
    });

    const queue = await listRequestsFor(deps, dispatcher, 'queue');

    assert.equal(queue.length, 1, 'закрытая заявка очередь не занимает');
    assert.equal(queue[0]?.description, 'Не работает лифт');
  });

  it('«мои» для мастера, порученная работа, а не поданные им жалобы', async () => {
    const dispatcher = resident({ id: 'disp-1', maxUserId: 5005, role: 'dispatcher', apartmentId: undefined });
    const master = resident({ id: 'tech-1', maxUserId: 6006, role: 'technician', apartmentId: undefined });
    const deps = setup([resident(), dispatcher, master]);

    const created = await createServiceRequest(deps, { resident: resident(), description: 'Течёт кран' });

    assert.deepEqual(await listRequestsFor(deps, master, 'mine'), []);

    await transitionRequest(deps, { resident: dispatcher, requestId: created.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.id,
      to: 'in_progress',
      assigneeId: master.id,
    });

    const assigned = await listRequestsFor(deps, master, 'mine');

    assert.deepEqual(
      assigned.map((request) => request.id),
      [created.id],
    );
  });

  it('своя заявка и свой наряд в списке не задваиваются', async () => {
    const dispatcher = resident({ id: 'disp-1', maxUserId: 5005, role: 'dispatcher', apartmentId: undefined });
    const master = resident({ id: 'tech-1', maxUserId: 6006, role: 'technician', apartmentId: 'apt-1' });
    const deps = setup([resident(), dispatcher, master]);

    const created = await createServiceRequest(deps, { resident: master, description: 'Течёт кран' });

    await transitionRequest(deps, { resident: dispatcher, requestId: created.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.id,
      to: 'in_progress',
      assigneeId: master.id,
    });

    assert.equal((await listRequestsFor(deps, master, 'mine')).length, 1);
  });

  it('жилец не открывает чужую заявку', async () => {
    const deps = setup();
    const created = await createServiceRequest(deps, { resident: resident(), description: 'Течёт кран' });

    const neighbour = resident({ id: 'res-2', maxUserId: 2002, apartmentId: 'apt-2' });

    await assert.rejects(getRequestFor(deps, neighbour, created.id), /не ваша/);
  });

  it('несуществующая заявка не найдена', async () => {
    const deps = setup();

    assert.equal(await getRequestFor(deps, resident(), 'нет-такой'), undefined);
    await assert.rejects(
      transitionRequest(deps, { resident: resident(), requestId: 'нет-такой', to: 'accepted' }),
      /не найдена/,
    );
  });
});

describe('переписка по заявке', () => {
  const dispatcher = resident({ id: 'disp-1', maxUserId: 5005, role: 'dispatcher', apartmentId: undefined });
  const master = resident({ id: 'tech-1', maxUserId: 6006, role: 'technician', apartmentId: undefined });

  const withNotifier = (residents: Resident[]) => {
    const notifier = createCollectingNotifier();

    return { deps: { ...setup(residents), notifier }, sent: notifier.sent };
  };

  it('вопрос жильца уходит исполнителю, а не всей смене', async () => {
    const { deps, sent } = withNotifier([resident(), dispatcher, master]);
    const created = await createServiceRequest(deps, { resident: resident(), description: 'Течёт кран' });

    await transitionRequest(deps, { resident: dispatcher, requestId: created.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.id,
      to: 'in_progress',
      assigneeId: master.id,
    });

    sent.length = 0;
    await commentRequest(deps, { resident: resident(), requestId: created.id, text: 'Когда приедете?' });

    assert.deepEqual(
      sent.map((message) => message.maxUserId),
      [master.maxUserId],
    );
    assert.match(sent[0]?.text ?? '', /Когда приедете\?/);
  });

  it('без исполнителя вопрос видит вся смена, иначе его не увидит никто', async () => {
    const { deps, sent } = withNotifier([resident(), dispatcher, master]);
    const created = await createServiceRequest(deps, { resident: resident(), description: 'Течёт кран' });

    sent.length = 0;
    await commentRequest(deps, { resident: resident(), requestId: created.id, text: 'Это срочно' });

    assert.deepEqual(
      sent.map((message) => message.maxUserId).sort(),
      [dispatcher.maxUserId, master.maxUserId].sort(),
    );
  });

  it('ответ управляющей организации получают все, кто сообщал', async () => {
    const neighbour = resident({ id: 'res-2', maxUserId: 2002, apartmentId: 'apt-2' });
    const { deps, sent } = withNotifier([resident(), neighbour, dispatcher]);
    const riser = { startParam: 'rsr_b1_1_1' };

    const created = await createServiceRequest(deps, {
      resident: resident(),
      description: 'Нет воды в стояке',
      ...riser,
    });
    const second = await submitProblem(deps, { resident: neighbour, description: 'Нет воды в стояке', ...riser });

    assert.equal(second.kind, 'joined', 'обращение соседа приклеилось к заявке');

    sent.length = 0;
    await commentRequest(deps, { resident: dispatcher, requestId: created.id, text: 'Едем' });

    assert.deepEqual(
      sent.map((message) => message.maxUserId).sort(),
      [resident().maxUserId, neighbour.maxUserId].sort(),
    );
  });

  it('на общей заявке соседи слышат друг друга, а не только управляющую организацию', async () => {
    const neighbour = resident({ id: 'res-2', maxUserId: 2002, apartmentId: 'apt-2' });
    const { deps, sent } = withNotifier([resident(), neighbour, dispatcher]);
    const riser = { startParam: 'rsr_b1_1_1' };

    const created = await createServiceRequest(deps, {
      resident: resident(),
      description: 'Нет воды в стояке',
      ...riser,
    });

    await submitProblem(deps, { resident: neighbour, description: 'Нет воды в стояке', ...riser });

    sent.length = 0;
    await commentRequest(deps, { resident: neighbour, requestId: created.id, text: 'У меня с шестого этажа тоже' });

    assert.deepEqual(
      sent.map((message) => message.maxUserId).sort(),
      [dispatcher.maxUserId, resident().maxUserId].sort(),
    );
    assert.match(sent.find((message) => message.maxUserId === resident().maxUserId)?.text ?? '', /Сосед пишет/);
    assert.match(sent.find((message) => message.maxUserId === dispatcher.maxUserId)?.text ?? '', /Жилец пишет/);
  });

  it('на своей заявке сообщение соседям не рассылается', async () => {
    const { deps, sent } = withNotifier([resident(), dispatcher]);
    const created = await createServiceRequest(deps, { resident: resident(), description: 'Течёт кран' });

    sent.length = 0;
    await commentRequest(deps, { resident: resident(), requestId: created.id, text: 'Это срочно' });

    assert.deepEqual(
      sent.map((message) => message.maxUserId),
      [dispatcher.maxUserId],
    );
  });

  it('чужую заявку жилец не комментирует', async () => {
    const deps = setup([resident()]);
    const created = await createServiceRequest(deps, { resident: resident(), description: 'Течёт кран' });
    const stranger = resident({ id: 'res-9', maxUserId: 9009, apartmentId: 'apt-3' });

    await assert.rejects(
      commentRequest(deps, { resident: stranger, requestId: created.id, text: 'А что случилось?' }),
      DomainError,
    );
  });
});

describe('объявления', () => {
  const manager = resident({ id: 'mgr-1', maxUserId: 7007, role: 'manager', apartmentId: undefined });

  it('охват считается до отправки', async () => {
    const deps = setup([manager]);

    const published = await publishAnnouncement(deps, {
      resident: manager,
      title: 'Отключение воды',
      body: 'Завтра с 9 до 14',
      entrance: 1,
      riser: 2,
    });

    assert.equal(published.description, 'подъезд 1, стояк 2');
    assert.equal(published.announcement.recipientIds.length, 1);
  });

  it('мастер объявления не публикует', async () => {
    const deps = setup();

    await assert.rejects(
      publishAnnouncement(deps, {
        resident: resident({ role: 'technician' }),
        title: 'Тест',
        body: 'Текст',
      }),
      /управляющая организация/,
    );
  });
});

describe('адресат объявления из хранилища', () => {
  const stored = (audience: { kind: 'building' | 'entrance' | 'riser'; entrance?: number; riser?: number }) => ({
    id: 'ann-1',
    buildingId: BUILDING_ID,
    audience,
    title: 'Тест',
    body: 'Текст',
    createdAt: NOW,
    recipientIds: [],
  });

  it('собирается обратно вместе с домом', () => {
    assert.deepEqual(announcementAudience(stored({ kind: 'riser', entrance: 1, riser: 2 })), {
      kind: 'riser',
      buildingId: BUILDING_ID,
      entrance: 1,
      riser: 2,
    });

    assert.deepEqual(announcementAudience(stored({ kind: 'entrance', entrance: 3 })), {
      kind: 'entrance',
      buildingId: BUILDING_ID,
      entrance: 3,
    });

    assert.deepEqual(announcementAudience(stored({ kind: 'building' })), {
      kind: 'building',
      buildingId: BUILDING_ID,
    });
  });

  it('неполная запись читается как общедомовая, а не падает', () => {
    assert.deepEqual(announcementAudience(stored({ kind: 'riser', entrance: 1 })), {
      kind: 'building',
      buildingId: BUILDING_ID,
    });
  });
});

describe('лента объявлений', () => {
  const manager = resident({ id: 'mgr-1', maxUserId: 7007, role: 'manager', apartmentId: undefined });

  /** Часы идут вперёд: иначе у всех объявлений одно время и порядок нечем проверить. */
  const ticking = (residents: Resident[]): AppDeps => {
    const deps = setup(residents);
    let tick = 0;

    return { ...deps, now: () => new Date(NOW.getTime() + tick++ * 60_000) };
  };

  const publish = async (deps: AppDeps, title: string, where: { entrance?: number; riser?: number } = {}) => {
    await publishAnnouncement(deps, { resident: manager, title, body: `${title}: подробности`, ...where });
  };

  it('жилец видит объявления всего дома и своего стояка', async () => {
    const deps = ticking([manager]);

    await publish(deps, 'Плановое отключение', { entrance: 1, riser: 1 });
    await publish(deps, 'Собрание собственников');
    await publish(deps, 'Ремонт в другом подъезде', { entrance: 2 });

    const seen = await listAnnouncementsFor(deps, resident());

    assert.deepEqual(
      seen.map((announcement) => announcement.title),
      ['Собрание собственников', 'Плановое отключение'],
      'новое сверху, чужой подъезд не показан',
    );
  });

  it('сотрудник видит всё по дому', async () => {
    const deps = ticking([manager]);

    await publish(deps, 'Ремонт в другом подъезде', { entrance: 2 });
    await publish(deps, 'Собрание собственников');

    const seen = await listAnnouncementsFor(deps, manager);

    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.title, 'Собрание собственников');
  });

  it('жильцу без квартиры остаётся общее по дому', async () => {
    const deps = ticking([manager]);

    await publish(deps, 'Плановое отключение', { entrance: 1, riser: 1 });
    await publish(deps, 'Собрание собственников');

    const seen = await listAnnouncementsFor(deps, resident({ apartmentId: undefined }));

    assert.deepEqual(
      seen.map((announcement) => announcement.title),
      ['Собрание собственников'],
    );
  });
});

describe('описание кода объекта', () => {
  it('квартира описывается номером из справочника', async () => {
    const deps = setup();

    const described = await describeContext(deps, 'apt_apt-3');

    assert.equal(described?.target, 'квартира 20');
    assert.equal(described?.audience, null, 'соседей заявка по квартире не касается');
  });

  it('неизвестный код даёт пустой результат', async () => {
    const deps = setup();

    assert.equal(await describeContext(deps, 'ерунда'), null);
  });
});
