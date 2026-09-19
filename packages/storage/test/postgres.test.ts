import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import {
  asRequest,
  FORGOTTEN_NAME,
  answerSupport,
  askSupport,
  checkInspectionItem,
  closeDuePolls,
  createServiceRequest,
  forgetResident,
  listAnnouncementsFor,
  planInspections,
  listRequestsFor,
  submitProblem,
  submitReading,
  pollProtocol,
  publishAnnouncement,
  saveContact,
  setNotice,
  transitionRequest,
  type AppDeps,
  type Resident,
} from '@domovoy/app';
import pg from 'pg';

import { PostgresRepository, applyMigrations, fromPool } from '../dist/index.js';

/** Тесты идут по настоящей базе: SQL проверяется только SQL-ом. */
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/domovoy_test';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-03T10:00:00Z');

const author: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const neighbour: Resident = {
  id: 'res-2',
  maxUserId: 2002,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

/** Живёт на одном стояке с автором: на нём проверяется склейка обращений. */
const riserNeighbour: Resident = {
  id: 'res-3',
  maxUserId: 3003,
  displayName: 'Павел',
  role: 'resident',
  apartmentId: 'apt-4',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Диспетчер',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

/** База проверяется до объявления набора: `skip` вычисляется при сборке тестов. */
const connect = async (): Promise<pg.Pool | undefined> => {
  const candidate = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });

  try {
    await candidate.query('select 1');
    await applyMigrations(fromPool(candidate));
    return candidate;
  } catch {
    await candidate.end();
    return undefined;
  }
};

const pool = await connect();

after(async () => {
  await pool?.end();
});

const setup = async (): Promise<AppDeps> => {
  if (!pool) throw new Error('база недоступна');

  await pool.query(
    'truncate audit_entry, poll_vote, poll, meter_reading, meter, announcement_recipient, announcement, ' +
      'attachment_file, request_event, service_request, resident, equipment, apartment, building cascade',
  );

  await pool.query('insert into building (id, code, address) values ($1, $2, $3)', [
    BUILDING_ID,
    'Д15',
    'ул. Ленина, 15',
  ]);

  await pool.query(
    `insert into apartment (id, building_id, number, entrance, riser) values
     ('apt-1', $1, 1, 1, 1), ('apt-2', $1, 2, 1, 2), ('apt-3', $1, 20, 2, 1),
     ('apt-4', $1, 5, 1, 1)`,
    [BUILDING_ID],
  );

  const repository = new PostgresRepository(pool);

  for (const resident of [author, neighbour, riserNeighbour, dispatcher]) {
    await repository.saveResident(resident);
  }

  let counter = 0;

  return {
    repository,
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
  };
};

describe('хранилище в Postgres', { skip: pool ? false : 'база недоступна' }, () => {
  let deps: AppDeps;

  beforeEach(async () => {
    deps = await setup();
  });

  it('находит жильца по идентификатору MAX', async () => {
    const found = await deps.repository.findResidentByMaxUserId(1001);

    assert.equal(found?.id, author.id);
    assert.equal(found?.apartmentId, 'apt-1');
    assert.equal(typeof found?.maxUserId, 'number', 'bigint не должен приезжать строкой');
  });

  it('повторное сохранение обновляет профиль, а не дублирует', async () => {
    await deps.repository.saveResident({ ...author, displayName: 'Мария Иванова', role: 'manager' });

    const found = await deps.repository.findResidentByMaxUserId(1001);

    assert.equal(found?.displayName, 'Мария Иванова');
    assert.equal(found?.role, 'manager');
  });

  it('заявка сохраняется вместе с объектом и историей', async () => {
    const created = await createServiceRequest(deps, {
      resident: author,
      description: 'Лифт застрял между этажами',
      startParam: 'eqp_b1_lift-2',
    });

    const loaded = await deps.repository.findRequest(created.id);

    assert.equal(loaded?.number, 'Д15-2609-0001');
    assert.deepEqual(loaded?.target, { kind: 'equipment', buildingId: BUILDING_ID, equipmentId: 'lift-2' });
    assert.equal(loaded?.priority, 'emergency');
    assert.equal(loaded?.history.length, 1);
    assert.equal(loaded?.createdAt.getTime(), NOW.getTime());
  });

  it('осмотр сохраняется вместе с пунктами и найденной заявкой', async () => {
    const [round] = (await planInspections(deps, BUILDING_ID)).filter(
      (item) => item.kind === 'entrance' && item.entrance === 1,
    );

    assert.ok(round, 'осмотр подъезда заводится по списку квартир');

    const result = await checkInspectionItem(deps, {
      resident: dispatcher,
      inspectionId: round.id,
      index: 1,
      state: 'problem',
      comment: 'Не закрывается входная дверь',
    });

    const loaded = await deps.repository.findInspection(round.id);

    assert.equal(loaded?.items[1]?.state, 'problem');
    assert.equal(loaded?.items[1]?.comment, 'Не закрывается входная дверь');
    assert.equal(loaded?.items[0]?.state, undefined, 'до первого пункта ещё не дошли');
    assert.deepEqual(loaded?.requestIds, [result.requestId]);
  });

  it('категория безопасности принимается базой', async () => {
    const created = await createServiceRequest(deps, {
      resident: author,
      description: 'В подъезде пахнет дымом',
      apartmentId: 'apt-1',
    });

    const loaded = await deps.repository.findRequest(created.id);

    assert.equal(loaded?.category, 'safety');
    assert.equal(loaded?.priority, 'emergency');
  });

  it('номер квартиры хранится в заявке, а не только в справочнике', async () => {
    const created = await createServiceRequest(deps, {
      resident: dispatcher,
      description: 'Течёт кран',
      apartmentId: 'apt-2',
    });

    const loaded = await deps.repository.findRequest(created.id);

    assert.deepEqual(loaded?.target, { kind: 'apartment', apartmentId: 'apt-2', number: 2 });
  });

  it('поднятый на стояк адрес переживает перезагрузку', async () => {
    const first = asRequest(await submitProblem(deps, { resident: author, description: 'Нет горячей воды' }));
    const second = asRequest(await submitProblem(deps, { resident: riserNeighbour, description: 'Нет горячей воды' }));

    assert.equal(second.kind, 'joined');

    const loaded = await deps.repository.findRequest(first.request.id);

    assert.deepEqual(loaded?.target, { kind: 'riser', buildingId: BUILDING_ID, entrance: 1, riser: 1 });
  });

  it('название оборудования доезжает до заявки', async () => {
    await deps.repository.saveEquipment({ buildingId: BUILDING_ID, code: 'lift-2', title: 'Лифт, подъезд 2' });

    const created = await createServiceRequest(deps, {
      resident: author,
      description: 'Лифт застрял',
      startParam: 'eqp_b1_lift-2',
    });

    const loaded = await deps.repository.findRequest(created.id);

    assert.deepEqual(loaded?.target, {
      kind: 'equipment',
      buildingId: BUILDING_ID,
      equipmentId: 'lift-2',
      title: 'Лифт, подъезд 2',
    });
  });

  it('оборудование без справочника заявку не ломает', async () => {
    const created = await createServiceRequest(deps, {
      resident: author,
      description: 'Домофон молчит',
      startParam: 'eqp_b1_domofon-9',
    });

    assert.deepEqual((await deps.repository.findRequest(created.id))?.target, {
      kind: 'equipment',
      buildingId: BUILDING_ID,
      equipmentId: 'domofon-9',
    });
  });

  it('адрес по стояку восстанавливается из колонок', async () => {
    const created = await createServiceRequest(deps, {
      resident: author,
      description: 'Нет горячей воды',
      startParam: 'rsr_b1_1_2',
    });

    const loaded = await deps.repository.findRequest(created.id);

    assert.deepEqual(loaded?.target, { kind: 'riser', buildingId: BUILDING_ID, entrance: 1, riser: 2 });
  });

  it('история растёт, а не переписывается', async () => {
    const created = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    await transitionRequest(deps, { resident: dispatcher, requestId: created.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.id,
      to: 'in_progress',
      assigneeId: dispatcher.id,
    });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.id,
      to: 'needs_info',
      comment: 'Когда удобно прийти?',
    });

    const loaded = await deps.repository.findRequest(created.id);

    assert.equal(loaded?.status, 'needs_info');
    assert.deepEqual(
      loaded?.history.map((event) => event.status),
      ['new', 'accepted', 'in_progress', 'needs_info'],
    );
    assert.equal(loaded?.history.at(-1)?.comment, 'Когда удобно прийти?');
  });

  it('подтверждение выезда переживает перезагрузку заявки', async () => {
    const created = await createServiceRequest(deps, {
      resident: author,
      description: 'Не едет лифт',
      startParam: `eqp_${BUILDING_ID}_lift-1`,
    });

    await transitionRequest(deps, { resident: dispatcher, requestId: created.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.id,
      to: 'in_progress',
      assigneeId: dispatcher.id,
    });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.id,
      to: 'done',
      comment: 'Заменил ролики дверей',
      provedBy: `eqp_${BUILDING_ID}_lift-1`,
    });

    const loaded = await deps.repository.findRequest(created.id);

    assert.equal(loaded?.history.at(-1)?.onSite, true);
    assert.equal(loaded?.history.at(0)?.onSite, undefined, 'подача заявки выездом не подтверждается');
  });

  it('номера заявок в доме идут по порядку', async () => {
    const first = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });
    const second = await createServiceRequest(deps, { resident: neighbour, description: 'Не работает свет' });

    assert.equal(first.number, 'Д15-2609-0001');
    assert.equal(second.number, 'Д15-2609-0002');
  });

  it('дома компании перечисляются: регулярные проверки идут по всем', async () => {
    await deps.repository.saveBuilding({ id: 'b2', code: 'Д17', address: 'ул. Ленина, 17' });

    assert.deepEqual(
      (await deps.repository.listBuildings()).map((building) => building.id).sort(),
      [BUILDING_ID, 'b2'].sort(),
    );
  });

  it('жилец видит свои заявки, сотрудник, очередь дома', async () => {
    await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });
    await createServiceRequest(deps, { resident: neighbour, description: 'Не работает свет' });

    assert.equal((await listRequestsFor(deps, author, 'mine')).length, 1);
    assert.equal((await listRequestsFor(deps, dispatcher, 'queue')).length, 2);
  });

  it('объявление сохраняет адресатов', async () => {
    const published = await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Отключение воды',
      body: 'Завтра с 9 до 14',
      entrance: 1,
      riser: 2,
    });

    const [stored] = await deps.repository.listAnnouncements(BUILDING_ID);

    assert.equal(stored?.title, 'Отключение воды');
    assert.deepEqual(stored?.audience, { kind: 'riser', entrance: 1, riser: 2 });
    assert.deepEqual(stored?.recipientIds, ['apt-2']);
    assert.equal(published.notified, 1, 'уведомление ушло жильцу этого стояка');
  });

  it('объявление всему дому не теряет адресатов', async () => {
    await publishAnnouncement(deps, { resident: dispatcher, title: 'Собрание', body: 'В субботу' });

    const [stored] = await deps.repository.listAnnouncements(BUILDING_ID);

    assert.equal(stored?.recipientIds.length, 4, 'все квартиры дома');
    assert.deepEqual(stored?.audience, { kind: 'building' });
  });

  it('плановые работы переживают перезагрузку и отвечают жильцу', async () => {
    const now = deps.now();

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Замена задвижки',
      body: 'Отключение воды на время работ',
      entrance: 1,
      riser: 2,
      works: {
        category: 'plumbing',
        from: new Date(now.getTime() - 3600_000),
        until: new Date(now.getTime() + 3 * 3600_000),
      },
    });

    const [stored] = await deps.repository.listAnnouncements(BUILDING_ID);

    assert.equal(stored?.works?.category, 'plumbing');
    assert.equal(stored?.works?.until.getTime(), now.getTime() + 3 * 3600_000);

    const answered = await submitProblem(deps, { resident: neighbour, description: 'Нет горячей воды' });

    assert.equal(answered.kind, 'planned');

    const unrelated = asRequest(await submitProblem(deps, { resident: riserNeighbour, description: 'Нет горячей воды' }));

    assert.equal(unrelated.kind, 'created');
  });

  it('идущие работы выбираются отдельным запросом, не читая ленту целиком', async () => {
    const now = deps.now();

    await publishAnnouncement(deps, { resident: dispatcher, title: 'Собрание', body: 'В субботу' });

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Уже закончились',
      body: 'Вчерашняя замена стояка',
      works: {
        category: 'plumbing',
        from: new Date(now.getTime() - 48 * 3600_000),
        until: new Date(now.getTime() - 24 * 3600_000),
      },
    });

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Ещё не начались',
      body: 'Завтрашнее отключение',
      works: {
        category: 'plumbing',
        from: new Date(now.getTime() + 24 * 3600_000),
        until: new Date(now.getTime() + 30 * 3600_000),
      },
    });

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Идут сейчас',
      body: 'Замена задвижки',
      works: {
        category: 'plumbing',
        from: new Date(now.getTime() - 3600_000),
        until: new Date(now.getTime() + 3600_000),
      },
    });

    assert.deepEqual(
      (await deps.repository.listWorksBetween(BUILDING_ID, now, now)).map((announcement) => announcement.title),
      ['Идут сейчас'],
    );

    const day = 24 * 3600_000;

    assert.deepEqual(
      (await deps.repository.listWorksBetween(BUILDING_ID, new Date(now.getTime() - 2 * day), new Date(now.getTime() + day)))
        .map((announcement) => announcement.title)
        .sort(),
      ['Ещё не начались', 'Идут сейчас', 'Уже закончились'].sort(),
    );
  });

  it('обычное объявление сроков работ не приобретает', async () => {
    await publishAnnouncement(deps, { resident: dispatcher, title: 'Собрание', body: 'В субботу' });

    const [stored] = await deps.repository.listAnnouncements(BUILDING_ID);

    assert.equal(stored?.works, undefined);
  });

  it('лента объявлений фильтруется по адресату', async () => {
    await publishAnnouncement(deps, { resident: dispatcher, title: 'Стояк', body: 'Вода', entrance: 1, riser: 2 });
    await publishAnnouncement(deps, { resident: dispatcher, title: 'Дом', body: 'Собрание' });

    const forAuthor = await listAnnouncementsFor(deps, author);
    const forNeighbour = await listAnnouncementsFor(deps, neighbour);

    assert.deepEqual(
      forAuthor.map((announcement) => announcement.title),
      ['Дом'],
      'объявление по чужому стояку жильцу не показывается',
    );
    assert.equal(forNeighbour.length, 2, 'жилец этого стояка видит оба');
    assert.equal((await listAnnouncementsFor(deps, dispatcher)).length, 2, 'сотрудник видит всё по дому');
  });

  it('подтверждения соседей переживают перезагрузку', async () => {
    const first = asRequest(await submitProblem(deps, { resident: author, description: 'Нет горячей воды' }));
    const second = asRequest(await submitProblem(deps, { resident: riserNeighbour, description: 'Нет горячей воды' }));

    assert.equal(second.kind, 'joined');

    const stored = await deps.repository.findRequest(first.request.id);

    assert.deepEqual(stored?.joinedBy, [{ residentId: riserNeighbour.id, at: NOW }]);
    assert.equal((await deps.repository.listRequests({})).length, 1, 'вторая заявка в базу не попала');
  });

  it('сосед с другого стояка заводит свою заявку', async () => {
    asRequest(await submitProblem(deps, { resident: author, description: 'Нет горячей воды' }));
    const other = asRequest(await submitProblem(deps, { resident: neighbour, description: 'Нет горячей воды' }));

    assert.equal(other.kind, 'created', 'чужой стояк, другая авария');
    assert.equal((await deps.repository.listRequests({})).length, 2);
  });

  it('заявка соседа видна ему в своём списке', async () => {
    const first = asRequest(await submitProblem(deps, { resident: author, description: 'Нет горячей воды' }));
    asRequest(await submitProblem(deps, { resident: riserNeighbour, description: 'Нет горячей воды' }));

    const mine = await deps.repository.listRequests({ reporterId: riserNeighbour.id });

    assert.deepEqual(
      mine.map((request) => request.id),
      [first.request.id],
      'фильтр по сообщившему собирает и свои заявки, и подтверждённые',
    );
  });

  it('фильтр по исполнителю собирает рабочий список мастера', async () => {
    const created = asRequest(await submitProblem(deps, { resident: author, description: 'Нет горячей воды' }));

    assert.equal(created.kind, 'created');
    assert.deepEqual(await deps.repository.listRequests({ assigneeId: dispatcher.id }), [], 'пока не назначено');

    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.request.id,
      to: 'in_progress',
      assigneeId: dispatcher.id,
    });

    const assigned = await deps.repository.listRequests({ assigneeId: dispatcher.id });

    assert.deepEqual(
      assigned.map((request) => request.id),
      [created.request.id],
    );
  });

  it('непривязанные жильцы находятся, а сотрудники в список не попадают', async () => {
    await deps.repository.saveResident({
      id: 'res-new',
      maxUserId: 9009,
      displayName: 'Новосёл',
      role: 'resident',
    });

    const unbound = await deps.repository.listUnboundResidents();

    assert.deepEqual(
      unbound.map((resident) => resident.id),
      ['res-new'],
      'диспетчер без квартиры, это не непривязанный жилец',
    );

    await deps.repository.saveResident({
      id: 'res-new',
      maxUserId: 9009,
      displayName: 'Новосёл',
      role: 'resident',
      apartmentId: 'apt-3',
      buildingId: BUILDING_ID,
    });

    assert.deepEqual(await deps.repository.listUnboundResidents(), []);
  });

  it('люди дома перечисляются вместе с сотрудниками', async () => {
    const people = await deps.repository.listResidents(BUILDING_ID);

    assert.deepEqual(
      people.map((person) => person.id).sort(),
      [author.id, neighbour.id, riserNeighbour.id, dispatcher.id].sort(),
    );
  });

  it('жилец со второй квартирой числится в обоих домах', async () => {
    await pool!.query('insert into building (id, code, address) values ($1, $2, $3)', ['b2', 'Д17', 'ул. Ленина, 17']);
    await pool!.query('insert into apartment (id, building_id, number, entrance, riser) values ($1, $2, 7, 1, 1)', [
      'apt-7',
      'b2',
    ]);
    await deps.repository.saveResident({ ...author, apartmentIds: ['apt-1', 'apt-7'] });

    assert.equal(
      (await deps.repository.listResidents('b2')).map((person) => person.id).includes(author.id),
      true,
      'вторая квартира стоит в другом доме, а человек работает с первой',
    );
    assert.equal((await deps.repository.listResidents(BUILDING_ID)).length, 4);
  });

  it('повторное подтверждение не ломает запись', async () => {
    const first = asRequest(await submitProblem(deps, { resident: author, description: 'Нет горячей воды' }));
    const joined = asRequest(await submitProblem(deps, { resident: riserNeighbour, description: 'Нет горячей воды' }));

    await deps.repository.saveRequest(joined.request);

    const stored = await deps.repository.findRequest(first.request.id);

    assert.deepEqual(stored?.joinedBy, [{ residentId: riserNeighbour.id, at: NOW }]);
  });

  it('вложения сохраняются вместе с расшифровкой', async () => {
    const created = await createServiceRequest(deps, {
      resident: author,
      description: 'не работает лифт в подъезде',
      attachments: [
        { kind: 'photo', token: 'photo-1' },
        { kind: 'voice', token: 'voice-1', transcript: 'не работает лифт в подъезде' },
      ],
    });

    const stored = await deps.repository.findRequest(created.id);

    assert.deepEqual(stored?.attachments, [
      { kind: 'photo', token: 'photo-1' },
      { kind: 'voice', token: 'voice-1', transcript: 'не работает лифт в подъезде' },
    ]);
  });

  it('переоткрытия считаются и в базе', async () => {
    const created = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    await transitionRequest(deps, { resident: dispatcher, requestId: created.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.id,
      to: 'in_progress',
      assigneeId: dispatcher.id,
    });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.id,
      to: 'done',
      comment: 'Заменил прокладку',
    });

    await transitionRequest(deps, {
      resident: author,
      requestId: created.id,
      to: 'in_progress',
      comment: 'Вода так и не появилась',
    });

    const stored = await deps.repository.findRequest(created.id);

    assert.equal(stored?.status, 'in_progress');
    assert.equal(stored?.reopenCount, 1);
  });

  it('сотрудники дома находятся отдельно от жильцов', async () => {
    const staff = await deps.repository.listStaff(BUILDING_ID);

    assert.deepEqual(
      staff.map((person) => person.id),
      [dispatcher.id],
      'жильцы в список сотрудников не попадают',
    );

    assert.deepEqual(await deps.repository.listStaff('другой-дом'), [], 'чужой дом, чужие сотрудники');
  });

  it('управляющая организация сохраняется и попадает в обращение', async () => {
    await deps.repository.saveBuilding({
      id: BUILDING_ID,
      code: 'Д15',
      address: 'ул. Ленина, 15',
      managementCompany: 'ООО «УК Ленинская»',
    });

    assert.equal((await deps.repository.findBuilding(BUILDING_ID))?.managementCompany, 'ООО «УК Ленинская»');
  });

  it('сведения об обслуживании переживают перезапись карточки', async () => {
    await deps.repository.saveBuilding({
      id: BUILDING_ID,
      code: 'Д15',
      address: 'ул. Ленина, 15',
      service: {
        emergencyPhone: '+7 900 120-00-15',
        phone: '+7 900 120-45-00',
        email: 'uk@example.ru',
        hours: 'пн-пт 9:00-18:00',
        office: 'ул. Ленина, 15, офис 1',
        officeHours: 'вт и чт 15:00-19:00',
      },
    });

    assert.deepEqual((await deps.repository.findBuilding(BUILDING_ID))?.service, {
      emergencyPhone: '+7 900 120-00-15',
      phone: '+7 900 120-45-00',
      email: 'uk@example.ru',
      hours: 'пн-пт 9:00-18:00',
      office: 'ул. Ленина, 15, офис 1',
      officeHours: 'вт и чт 15:00-19:00',
    });

    await deps.repository.saveBuilding({ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' });

    assert.equal('service' in ((await deps.repository.findBuilding(BUILDING_ID)) ?? {}), false);
  });

  it('запись на приём и приёмные окна переживают перезапись', async () => {
    await deps.repository.saveBuilding({
      id: BUILDING_ID,
      code: 'Д15',
      address: 'ул. Ленина, 15',
      reception: [{ weekday: 2, from: '15:00', to: '19:00' }],
      visitMinutes: 30,
    });

    const house = await deps.repository.findBuilding(BUILDING_ID);

    assert.deepEqual(house?.reception, [{ weekday: 2, from: '15:00', to: '19:00' }]);
    assert.equal(house?.visitMinutes, 30);

    const at = new Date('2026-09-22T10:00:00Z');

    await deps.repository.saveVisit({
      id: 'vis-1',
      buildingId: BUILDING_ID,
      residentId: author.id,
      at,
      minutes: 30,
      topic: 'Перерасчёт',
      status: 'booked',
      createdAt: NOW,
    });

    const booked = await deps.repository.listVisits({ buildingId: BUILDING_ID, statuses: ['booked'] });

    assert.equal(booked.length, 1);
    assert.equal(booked[0]?.at.getTime(), at.getTime());
    assert.equal(booked[0]?.minutes, 30);

    const first = booked[0];

    assert.ok(first);
    await deps.repository.saveVisit({ ...first, status: 'cancelled' });

    assert.equal((await deps.repository.listVisits({ buildingId: BUILDING_ID, statuses: ['booked'] })).length, 0);
    assert.equal((await deps.repository.findVisit('vis-1'))?.status, 'cancelled');
  });

  it('один код дома живёт у разных организаций, но не дважды у одной', async () => {
    await deps.repository.saveBuilding({ id: BUILDING_ID, code: 'Д1', address: 'ул. Ленина, 1', companyId: 'ук-1' });
    await deps.repository.saveBuilding({ id: 'дом-2', code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-2' });

    assert.equal((await deps.repository.findBuilding('дом-2'))?.companyId, 'ук-2');

    await assert.rejects(
      deps.repository.saveBuilding({ id: 'дом-3', code: 'Д1', address: 'ул. Мира, 3', companyId: 'ук-2' }),
      /building_code_per_company|duplicate key/,
    );
  });

  it('чат дома хранится числом, а не строкой из bigint', async () => {
    await deps.repository.saveBuilding({
      id: BUILDING_ID,
      code: 'Д15',
      address: 'ул. Ленина, 15',
      chatId: 9_007_199_254_740_990,
    });

    const [stored] = (await deps.repository.listBuildings()).filter((item) => item.id === BUILDING_ID);

    assert.equal(typeof stored?.chatId, 'number');
    assert.equal(stored?.chatId, 9_007_199_254_740_990);

    await deps.repository.saveBuilding({ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' });

    assert.equal('chatId' in ((await deps.repository.findBuilding(BUILDING_ID)) ?? {}), false);
  });

  it('статус «принята жильцом» база принимает', async () => {
    const created = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    for (const to of ['accepted', 'in_progress', 'done'] as const) {
      await transitionRequest(deps, {
        resident: dispatcher,
        requestId: created.id,
        to,
        ...(to === 'in_progress' ? { assigneeId: dispatcher.id } : {}),
        ...(to === 'done' ? { comment: 'Заменил кран' } : {}),
      });
    }

    const confirmed = await transitionRequest(deps, {
      resident: author,
      requestId: created.id,
      to: 'confirmed',
    });

    assert.equal(confirmed.status, 'confirmed');
    assert.equal((await deps.repository.findRequest(created.id))?.status, 'confirmed');
  });

  it('уникальность номера защищена базой', async () => {
    if (!pool) return;

    const created = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    await assert.rejects(
      pool.query(
        `insert into service_request (
           id, number, building_id, author_id, category, priority, status, title, description,
           target_kind, created_at, reaction_due_at, resolution_due_at
         ) values ('other', $1, $2, $3, 'other', 'normal', 'new', 'дубль', 'дубль', 'building', now(), now(), now())`,
        [created.number, BUILDING_ID, author.id],
      ),
      /duplicate key|unique/i,
      'два обращения с одним номером в базу не попадут',
    );
  });

  it('две заявки, поданные одновременно, получают разные номера', async () => {
    const [first, second] = await Promise.all([
      createServiceRequest(deps, { resident: author, description: 'Течёт кран' }),
      createServiceRequest(deps, { resident: neighbour, description: 'Не горит лампа в подъезде' }),
    ]);

    assert.deepEqual([first.number, second.number].sort(), ['Д15-2609-0001', 'Д15-2609-0002']);
  });

  it('счётчик номеров продолжает уже записанные заявки', async () => {
    if (!pool) return;

    await pool.query('delete from request_sequence where building_id = $1', [BUILDING_ID]);

    const created = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    assert.equal(created.number, 'Д15-2609-0001');

    await pool.query('delete from request_sequence where building_id = $1', [BUILDING_ID]);

    const next = await createServiceRequest(deps, { resident: neighbour, description: 'Не закрывается дверь' });

    assert.equal(next.number, 'Д15-2609-0002', 'потерянный счётчик поднимается с заявок месяца');
  });

  it('заявка сохраняется целиком или не сохраняется вовсе', async () => {
    if (!pool) return;

    const transactional = new PostgresRepository(fromPool(pool));

    await assert.rejects(
      transactional.createRequest({
        id: 'broken',
        buildingId: BUILDING_ID,
        buildingCode: 'Д15',
        sequence: 99,
        authorId: 'нет-такого-жильца',
        category: 'plumbing',
        target: { kind: 'building', buildingId: BUILDING_ID },
        description: 'Течёт кран',
        createdAt: NOW,
      }),
    );

    const { rows } = await pool.query('select id from service_request where id = $1', ['broken']);

    assert.deepEqual(rows, []);
  });

  it('транзакция не мешает обычной записи', async () => {
    if (!pool) return;

    const transactional = new PostgresRepository(fromPool(pool));

    const created = await transactional.createRequest({
      id: 'ok',
      buildingId: BUILDING_ID,
      buildingCode: 'Д15',
      sequence: 98,
      authorId: author.id,
      category: 'plumbing',
      target: { kind: 'building', buildingId: BUILDING_ID },
      description: 'Течёт кран',
      createdAt: NOW,
      attachments: [{ kind: 'photo', token: 'p1' }],
    });

    const stored = await transactional.findRequest(created.id);

    assert.equal(stored?.history.length, 1);
    assert.equal(stored?.attachments.length, 1);
  });

  it('счётчики и показания живут в базе', async () => {
    await deps.repository.saveMeter({
      id: 'cold-1',
      apartmentId: 'apt-1',
      kind: 'cold_water',
      serial: 'ХВС-1',
      verifiedUntil: new Date('2030-01-01T00:00:00Z'),
    });

    await submitReading(deps, { resident: author, meterId: 'cold-1', value: 120.456 });

    const [meter] = await deps.repository.listMeters('apt-1');
    const [reading] = await deps.repository.listReadings('cold-1');

    assert.equal(meter?.serial, 'ХВС-1');
    assert.equal(meter?.verifiedUntil?.getUTCFullYear(), 2030);

    assert.equal(typeof reading?.value, 'number');
    assert.equal(reading?.value, 120.456);
  });

  it('история показаний идёт свежими вперёд', async () => {
    await deps.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    for (const [at, value] of [
      ['2026-07-22', 100],
      ['2026-08-22', 103],
      ['2026-09-22', 106],
    ] as const) {
      await deps.repository.saveReading({
        id: `r-${value}`,
        meterId: 'cold-1',
        value,
        at: new Date(`${at}T10:00:00Z`),
        submittedBy: author.id,
      });
    }

    const readings = await deps.repository.listReadings('cold-1');

    assert.deepEqual(
      readings.map((item) => item.value),
      [106, 103, 100],
    );
  });

  it('приборы и показания дома читаются пачкой, а не по одной квартире', async () => {
    for (const [id, apartmentId, serial] of [
      ['cold-1', 'apt-1', 'ХВС-1'],
      ['hot-1', 'apt-1', 'ГВС-1'],
      ['cold-2', 'apt-2', 'ХВС-2'],
    ] as const) {
      await deps.repository.saveMeter({ id, apartmentId, kind: id.startsWith('hot') ? 'hot_water' : 'cold_water', serial });
      await deps.repository.saveReading({
        id: `r-${id}`,
        meterId: id,
        value: 100,
        at: new Date('2026-09-22T10:00:00Z'),
        submittedBy: author.id,
      });
    }

    const meters = await deps.repository.listMetersByApartments(['apt-1', 'apt-2']);
    const readings = await deps.repository.listReadingsFor(meters.map((meter) => meter.id));

    assert.deepEqual(
      meters.map((meter) => meter.serial).sort(),
      ['ГВС-1', 'ХВС-1', 'ХВС-2'],
    );
    assert.equal(readings.length, 3);
    assert.equal(typeof readings[0]?.value, 'number');
  });

  it('пустой список приборов в базу не ходит и отвечает пустым', async () => {
    assert.deepEqual(await deps.repository.listMetersByApartments([]), []);
    assert.deepEqual(await deps.repository.listReadingsFor([]), []);
    assert.deepEqual(await deps.repository.listHouseReadingsFor([]), []);
  });

  it('общедомовой прибор живёт своей таблицей и хранит показания', async () => {
    await deps.repository.saveHouseMeter({
      id: 'house-cold',
      buildingId: BUILDING_ID,
      kind: 'cold_water',
      serial: 'ОДПУ-1',
      verifiedUntil: new Date('2030-01-01T00:00:00Z'),
    });

    for (const [id, value, day] of [
      ['hr-1', 1000, 20],
      ['hr-2', 1100, 22],
    ] as const) {
      await deps.repository.saveHouseReading({
        id,
        meterId: 'house-cold',
        value,
        at: new Date(`2026-09-${day}T10:00:00Z`),
        submittedBy: author.id,
      });
    }

    const [meter] = await deps.repository.listHouseMeters(BUILDING_ID);
    const readings = await deps.repository.listHouseReadingsFor(['house-cold']);

    assert.equal(meter?.serial, 'ОДПУ-1');
    assert.equal(meter?.verifiedUntil?.toISOString(), '2030-01-01T00:00:00.000Z');
    assert.deepEqual(
      readings.map((item) => item.value),
      [1100, 1000],
    );
    assert.deepEqual(await deps.repository.listReadingsFor(['house-cold']), []);

    await deps.repository.deleteHouseReading('hr-2');

    assert.equal((await deps.repository.listHouseReadingsFor(['house-cold'])).length, 1);
  });

  it('два показания одного счётчика в одну секунду заменяют друг друга', async () => {
    await deps.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    const at = new Date('2026-09-22T10:00:00Z');

    await deps.repository.saveReading({ id: 'r-1', meterId: 'cold-1', value: 100, at, submittedBy: author.id });

    const saved = await deps.repository.saveReading({
      id: 'r-2',
      meterId: 'cold-1',
      value: 101,
      at,
      submittedBy: author.id,
    });

    const readings = await deps.repository.listReadings('cold-1');

    assert.equal(readings.length, 1, 'показание на момент времени одно');
    assert.equal(readings[0]?.value, 101);
    assert.equal(saved.id, 'r-1', 'возвращается идентификатор записанной строки');
  });

  it('показание дома в тот же момент тоже заменяется', async () => {
    await deps.repository.saveHouseMeter({
      id: 'house-cold',
      buildingId: BUILDING_ID,
      kind: 'cold_water',
      serial: 'ОДПУ-1',
    });

    const at = new Date('2026-09-22T10:00:00Z');

    await deps.repository.saveHouseReading({ id: 'hr-1', meterId: 'house-cold', value: 1000, at, submittedBy: author.id });
    await deps.repository.saveHouseReading({ id: 'hr-2', meterId: 'house-cold', value: 1001, at, submittedBy: author.id });

    const readings = await deps.repository.listHouseReadingsFor(['house-cold']);

    assert.equal(readings.length, 1);
    assert.equal(readings[0]?.value, 1001);
  });

  it('повторное заведение общедомового прибора не падает на ключе', async () => {
    const first = await deps.repository.saveHouseMeter({
      id: 'house-a',
      buildingId: BUILDING_ID,
      kind: 'cold_water',
      serial: 'ОДПУ-1',
    });

    const second = await deps.repository.saveHouseMeter({
      id: 'house-b',
      buildingId: BUILDING_ID,
      kind: 'cold_water',
      serial: 'ОДПУ-2',
    });

    const meters = await deps.repository.listHouseMeters(BUILDING_ID);

    assert.equal(meters.length, 1, 'прибор на ресурс в доме один');
    assert.equal(meters[0]?.serial, 'ОДПУ-2');
    assert.equal(second.id, first.id, 'строка остаётся прежней');
  });

  it('площадь помещения возвращается числом', async () => {
    await deps.repository.saveApartment({
      id: 'apt-1',
      buildingId: BUILDING_ID,
      number: 1,
      entrance: 1,
      riser: 1,
      area: 75.5,
    });

    const [apartment] = await deps.repository.listApartments(BUILDING_ID);

    assert.equal(typeof apartment?.area, 'number');
    assert.equal(apartment?.area, 75.5);
  });

  it('голосование и голоса живут в базе', async () => {
    const poll = await deps.repository.savePoll({
      id: 'poll-1',
      buildingId: BUILDING_ID,
      kind: 'qualified',
      title: 'Ремонт подъездов',
      question: 'Утвердить смету',
      opensAt: new Date('2026-09-01T10:00:00Z'),
      closesAt: new Date('2026-09-15T10:00:00Z'),
    });

    await deps.repository.saveVote({
      pollId: poll.id,
      apartmentId: 'apt-1',
      choice: 'for',
      at: NOW,
      residentId: author.id,
    });

    const stored = await deps.repository.findPoll(poll.id);
    const [vote] = await deps.repository.listVotes(poll.id);

    assert.equal(stored?.kind, 'qualified');
    assert.equal(stored?.closesAt.getUTCDate(), 15);
    assert.equal(vote?.choice, 'for');
    assert.equal(vote?.apartmentId, 'apt-1');
  });

  it('журнал действий переживает перезапуск', async () => {
    const request = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'rejected',
      comment: 'Зона ответственности собственника',
    });

    const [entry] = await deps.repository.listAudit(BUILDING_ID, { limit: 10 });

    assert.equal(entry?.action, 'request_rejected');
    assert.equal(entry?.actorName, dispatcher.displayName);
    assert.equal(entry?.subject, request.number);
    assert.equal(entry?.details, 'Зона ответственности собственника');
    assert.deepEqual(await deps.repository.listAudit(BUILDING_ID, { limit: 10, before: entry.at }), []);
  });

  it('обезличенный профиль остаётся обезличенным', async () => {
    const request = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    await forgetResident(deps, author);

    const forgotten = await deps.repository.findResident(author.id);

    assert.equal(forgotten?.displayName, FORGOTTEN_NAME);
    assert.equal(forgotten?.maxUserId, undefined);
    assert.equal(forgotten?.apartmentId, undefined);
    assert.ok(forgotten?.forgottenAt, 'дата удаления записана');
    assert.equal((await deps.repository.findRequest(request.id))?.number, request.number);
    assert.equal(await deps.repository.findResidentByMaxUserId(author.maxUserId!), undefined);
  });

  it('итоги собрания переживают перезапуск', async () => {
    const poll = await deps.repository.savePoll({
      id: 'poll-3',
      buildingId: BUILDING_ID,
      kind: 'simple',
      title: 'Ремонт кровли',
      question: 'Утвердить смету',
      opensAt: new Date('2026-08-01T10:00:00Z'),
      closesAt: new Date('2026-08-15T10:00:00Z'),
      startedBy: author.id,
    });

    await deps.repository.saveVote({
      pollId: poll.id,
      apartmentId: 'apt-1',
      choice: 'for',
      at: new Date('2026-08-02T10:00:00Z'),
      residentId: author.id,
    });

    const [closed] = await closeDuePolls(deps);
    const stored = await deps.repository.findPoll(poll.id);

    assert.equal(closed?.poll.id, poll.id);
    assert.equal(stored?.closedAt?.getTime(), NOW.getTime());
    assert.equal(stored?.startedBy, author.id);
    assert.match(await pollProtocol(deps, author, poll.id), /Протокол общего собрания собственников/);
  });

  it('переголосование заменяет прежний выбор, а не добавляет второй', async () => {
    const poll = await deps.repository.savePoll({
      id: 'poll-1',
      buildingId: BUILDING_ID,
      kind: 'simple',
      title: 'Тест',
      question: 'Вопрос',
      opensAt: new Date('2026-09-01T10:00:00Z'),
      closesAt: new Date('2026-09-15T10:00:00Z'),
    });

    for (const choice of ['against', 'for'] as const) {
      await deps.repository.saveVote({
        pollId: poll.id,
        apartmentId: 'apt-1',
        choice,
        at: NOW,
        residentId: author.id,
      });
    }

    const votes = await deps.repository.listVotes(poll.id);

    assert.equal(votes.length, 1);
    assert.equal(votes[0]?.choice, 'for');
  });

  it('подписи под инициативой переживают перезапуск, а вторая от той же квартиры не добавляется', async () => {
    const initiative = await deps.repository.saveInitiative({
      id: 'ini-1',
      buildingId: BUILDING_ID,
      authorId: author.id,
      kind: 'simple',
      title: 'Шлагбаум во двор',
      question: 'Поставить шлагбаум на въезд',
      createdAt: NOW,
      signatures: [{ residentId: author.id, apartmentId: 'apt-1', at: NOW }],
    });

    await deps.repository.saveInitiative({
      ...initiative,
      signatures: [...initiative.signatures, { residentId: author.id, apartmentId: 'apt-1', at: NOW }],
    });

    const stored = await deps.repository.findInitiative(initiative.id);

    assert.equal(stored?.signatures.length, 1);
    assert.equal(stored?.title, 'Шлагбаум во двор');
    assert.equal(stored?.pollId, undefined);

    const poll = await deps.repository.savePoll({
      id: 'poll-ini',
      buildingId: BUILDING_ID,
      kind: 'simple',
      title: 'Шлагбаум во двор',
      question: 'Поставить шлагбаум на въезд',
      opensAt: NOW,
      closesAt: new Date(NOW.getTime() + 14 * 24 * 3600_000),
    });

    await deps.repository.saveInitiative({ ...initiative, pollId: poll.id });

    const [listed] = await deps.repository.listInitiatives(BUILDING_ID);

    assert.equal(listed?.pollId, poll.id);
  });

  it('полномочия старшего переживают перезапуск, а новые выборы сменяют прежние', async () => {
    const until = new Date(NOW.getTime() + 2 * 365 * 24 * 3600_000);

    await deps.repository.saveEldership({
      buildingId: BUILDING_ID,
      entrance: 1,
      residentId: author.id,
      since: NOW,
      until,
    });

    const [stored] = await deps.repository.listElderships(BUILDING_ID);

    assert.equal(stored?.residentId, author.id);
    assert.equal(stored?.until.getTime(), until.getTime());

    const later = new Date(NOW.getTime() + 3600_000);

    await deps.repository.saveEldership({
      buildingId: BUILDING_ID,
      entrance: 1,
      residentId: author.id,
      since: later,
      until,
    });

    const all = await deps.repository.listElderships(BUILDING_ID);

    assert.equal(all.length, 1);
    assert.equal(all[0]?.since.getTime(), later.getTime());
  });

  it('голосование с концом раньше начала база не принимает', async () => {
    await assert.rejects(
      deps.repository.savePoll({
        id: 'poll-broken',
        buildingId: BUILDING_ID,
        kind: 'simple',
        title: 'Тест',
        question: 'Вопрос',
        opensAt: new Date('2026-09-15T10:00:00Z'),
        closesAt: new Date('2026-09-01T10:00:00Z'),
      }),
      /check|constraint/i,
    );
  });

  it('снимок возвращается из базы байт в байт', async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x10, 0xfe, 0x7f]);

    await deps.repository.saveFile({
      id: 'file-1',
      contentType: 'image/jpeg',
      bytes,
      uploadedBy: author.id,
      buildingId: BUILDING_ID,
      at: NOW,
    });

    const found = await deps.repository.findFile('file-1');

    assert.equal(found?.contentType, 'image/jpeg');
    assert.deepEqual([...(found?.bytes ?? [])], [...bytes]);
    assert.equal(found?.uploadedBy, author.id);
    assert.equal(found?.at.getTime(), NOW.getTime());
  });

  it('несуществующего снимка просто нет', async () => {
    assert.equal(await deps.repository.findFile('file-нет'), undefined);
  });

  it('снимок с заявкой доезжает до очереди', async () => {
    await deps.repository.saveFile({
      id: 'file-2',
      contentType: 'image/png',
      bytes: Uint8Array.from([1, 2, 3]),
      uploadedBy: author.id,
      buildingId: BUILDING_ID,
      at: NOW,
    });

    const created = asRequest(await submitProblem(deps, {
      resident: author,
      description: 'Течёт стояк в подвале',
      attachments: [{ kind: 'photo', token: 'file:file-2' }],
    }));

    assert.equal(created.kind, 'created');

    const stored = await deps.repository.findRequest(created.request.id);

    assert.deepEqual(stored?.attachments, [{ kind: 'photo', token: 'file:file-2' }]);
  });

  it('снимок мастера остаётся у своего события истории', async () => {
    const created = asRequest(await submitProblem(deps, { resident: author, description: 'Течёт кран' }));

    assert.equal(created.kind, 'created');

    let request = await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.request.id,
      to: 'accepted',
    });

    request = await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'in_progress',
      assigneeId: dispatcher.id,
    });

    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'done',
      comment: 'Заменил кран',
      attachments: [{ kind: 'photo', token: 'file:after' }],
    });

    const loaded = await deps.repository.findRequest(request.id);

    assert.deepEqual(loaded?.history.at(-1)?.attachments, [{ kind: 'photo', token: 'file:after' }]);
    assert.equal(loaded?.history[0]?.attachments, undefined);
    assert.deepEqual(loaded?.attachments, []);
  });

  it('повторное сохранение заявки не удваивает снимки в истории', async () => {
    const created = asRequest(await submitProblem(deps, { resident: author, description: 'Течёт кран' }));

    assert.equal(created.kind, 'created');

    let request = await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.request.id,
      to: 'accepted',
    });

    request = await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'in_progress',
      assigneeId: dispatcher.id,
      attachments: [{ kind: 'photo', token: 'file:before' }],
    });

    await deps.repository.saveRequest(request);

    const loaded = await deps.repository.findRequest(request.id);

    assert.deepEqual(loaded?.history.at(-1)?.attachments, [{ kind: 'photo', token: 'file:before' }]);
  });

  it('первый вход с двух устройств сразу не ломает вход', async () => {
    const newcomer = { maxUserId: 9_100_500, displayName: 'Новый жилец', role: 'resident' as const };

    const [first, second] = await Promise.all([
      deps.repository.saveResident({ ...newcomer, id: 'race-1', buildingId: BUILDING_ID }),
      deps.repository.saveResident({ ...newcomer, id: 'race-2', buildingId: BUILDING_ID }),
    ]);

    assert.equal(first.maxUserId, newcomer.maxUserId);
    assert.equal(second.maxUserId, newcomer.maxUserId);
    assert.equal(first.id, second.id, 'обоим достаётся один и тот же профиль');
  });

  it('назначение исполнителя остаётся в истории', async () => {
    const created = asRequest(await submitProblem(deps, { resident: author, description: 'Течёт кран' }));

    assert.equal(created.kind, 'created');

    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.request.id,
      to: 'in_progress',
      assigneeId: dispatcher.id,
    });

    const loaded = await deps.repository.findRequest(created.request.id);

    assert.equal(loaded?.history.at(-1)?.assigneeId, dispatcher.id);
    assert.equal(loaded?.history[0]?.assigneeId, undefined);
  });

  it('плановое ТО заводится по каждой единице оборудования', async () => {
    await deps.repository.saveEquipment({ buildingId: BUILDING_ID, code: 'lift-1', title: 'Лифт 1', kind: 'lift' });
    await deps.repository.saveEquipment({ buildingId: BUILDING_ID, code: 'lift-2', title: 'Лифт 2', kind: 'lift' });

    const planned = await planInspections(deps, BUILDING_ID);
    const lifts = planned.filter((round) => round.kind === 'lift');

    assert.deepEqual(
      lifts.map((round) => round.equipmentCode).sort(),
      ['lift-1', 'lift-2'],
    );

    const stored = (await deps.repository.listInspections(BUILDING_ID)).find((round) => round.kind === 'lift');

    assert.equal(stored?.equipmentCode, lifts[0]?.equipmentCode);
    assert.equal((await deps.repository.listEquipment(BUILDING_ID)).every((item) => item.kind === 'lift'), true);
  });

  it('телефон и отключённые уведомления переживают перезапуск', async () => {
    await saveContact(deps, author, '+79991234567');
    await setNotice(deps, (await deps.repository.findResident(author.id))!, 'news', false);

    const stored = await deps.repository.findResident(author.id);

    assert.equal(stored?.phone, '+79991234567');
    assert.deepEqual(stored?.mutes, ['news']);
  });

  it('подрядчик заводится в базе, но не попадает в смену дома', async () => {
    const contractor: Resident = {
      id: 'con-1',
      maxUserId: 9009,
      displayName: 'Лифтсервис',
      role: 'contractor',
      buildingId: BUILDING_ID,
    };

    await deps.repository.saveResident(contractor);

    const staff = await deps.repository.listStaff(BUILDING_ID);
    const people = await deps.repository.listResidents(BUILDING_ID);

    assert.equal(staff.some((person) => person.id === contractor.id), false, 'рассылки его не касаются');
    assert.equal(people.some((person) => person.id === contractor.id), true, 'поручить работу ему можно');
  });

  it('оценка жильца переживает перезапуск', async () => {
    const created = asRequest(await submitProblem(deps, { resident: author, description: 'Течёт кран' }));

    assert.equal(created.kind, 'created');

    let request = await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.request.id,
      to: 'accepted',
    });

    request = await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'in_progress',
      assigneeId: dispatcher.id,
    });
    request = await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'done',
      comment: 'Заменил кран',
    });

    await transitionRequest(deps, { resident: author, requestId: request.id, to: 'confirmed', rating: 4 });

    assert.equal((await deps.repository.findRequest(request.id))?.rating, 4);
  });

  it('оценку вне шкалы база не принимает', async () => {
    const created = asRequest(await submitProblem(deps, { resident: author, description: 'Течёт кран' }));

    assert.equal(created.kind, 'created');

    await assert.rejects(
      deps.repository.saveRequest({ ...created.request, rating: 7 }),
      /check|constraint/i,
    );
  });

  it('переписка с поддержкой сохраняется целиком', async () => {
    const asked = await askSupport(deps, { resident: author, text: 'Когда включат отопление?' });

    await answerSupport(deps, { staff: dispatcher, ticketId: asked.id, text: 'Подадим 25 сентября.' });

    const loaded = await deps.repository.findSupportTicket(asked.id);

    assert.equal(loaded?.status, 'answered');
    assert.equal(loaded?.messages.length, 2);
    assert.deepEqual(
      loaded?.messages.map((message) => message.from),
      ['resident', 'staff'],
      'порядок реплик сохраняется',
    );
    assert.equal(loaded?.messages[1]?.authorName, 'Диспетчер');
    assert.equal(loaded?.createdAt.getTime(), NOW.getTime());
  });

  it('обращения отбираются по дому, жильцу и состоянию', async () => {
    const mine = await askSupport(deps, { resident: author, text: 'Вопрос Марии' });

    await askSupport(deps, { resident: neighbour, text: 'Вопрос Ивана' });
    await answerSupport(deps, { staff: dispatcher, ticketId: mine.id, text: 'Ответ' });

    const all = await deps.repository.listSupportTickets({ buildingId: BUILDING_ID });
    const own = await deps.repository.listSupportTickets({ residentId: author.id });
    const waiting = await deps.repository.listSupportTickets({ buildingId: BUILDING_ID, statuses: ['open'] });

    assert.equal(all.length, 2);
    assert.deepEqual(
      own.map((ticket) => ticket.subject),
      ['Вопрос Марии'],
    );
    assert.deepEqual(
      waiting.map((ticket) => ticket.subject),
      ['Вопрос Ивана'],
    );
  });

  it('ответственный по дому сохраняется вместе с карточкой', async () => {
    await deps.repository.saveBuilding({
      id: BUILDING_ID,
      code: 'Д15',
      address: 'ул. Ленина, 15',
      contact: {
        name: 'Гордеева Нина Павловна',
        role: 'управляющая домом',
        phone: '+7 900 120-45-15',
        email: 'nina@uk.ru',
      },
    });

    const loaded = await deps.repository.findBuilding(BUILDING_ID);

    assert.equal(loaded?.contact?.name, 'Гордеева Нина Павловна');
    assert.equal(loaded?.contact?.email, 'nina@uk.ru');
  });

  it('переданное обращение читается по заявке и по дому', async () => {
    const request = await createServiceRequest(deps, { resident: author, description: 'Нет горячей воды' });
    const dueAt = new Date(NOW.getTime() + 2 * 3600_000);

    await deps.repository.saveHandoff({
      id: 'handoff-1',
      requestId: request.id,
      buildingId: BUILDING_ID,
      to: 'resource',
      organization: 'Теплосеть',
      channel: 'gis_zhkh',
      externalId: 'ГИС-42',
      status: 'sent',
      dueAt,
      createdAt: NOW,
      byResident: true,
    });

    const stored = await deps.repository.findHandoff('handoff-1');

    assert.ok(stored);
    assert.equal(stored?.to, 'resource');
    assert.equal(stored?.organization, 'Теплосеть');
    assert.equal(stored?.channel, 'gis_zhkh');
    assert.equal(stored?.externalId, 'ГИС-42');
    assert.equal(stored?.byResident, true);
    assert.equal(stored?.dueAt.getTime(), dueAt.getTime());
    assert.equal(stored?.answer, undefined);

    const byRequest = await deps.repository.listHandoffs({ requestId: request.id });
    const waiting = await deps.repository.listHandoffs({ buildingId: BUILDING_ID, waiting: true });

    assert.equal(byRequest.length, 1);
    assert.equal(waiting.length, 1, 'ответа ещё нет');

    await deps.repository.saveHandoff({
      ...stored,
      status: 'answered',
      answer: 'Устранено, подача восстановлена',
      answeredAt: NOW,
    });

    const answered = await deps.repository.findHandoff('handoff-1');

    assert.equal(answered?.status, 'answered');
    assert.equal(answered?.answer, 'Устранено, подача восстановлена');
    assert.equal(answered?.answeredAt?.getTime(), NOW.getTime());
    assert.deepEqual(await deps.repository.listHandoffs({ buildingId: BUILDING_ID, waiting: true }), []);
  });

  it('вид собрания, сообщение и протокол переживают перезапуск', async () => {
    const meeting = await deps.repository.savePoll({
      id: 'poll-meeting',
      buildingId: BUILDING_ID,
      kind: 'qualified',
      mode: 'meeting',
      title: 'Капитальный ремонт кровли',
      question: 'Утвердить смету',
      opensAt: NOW,
      closesAt: new Date(NOW.getTime() + 10 * 24 * 3600_000),
      noticeId: 'notice-77',
      protocolId: 'protocol-12',
    });

    const stored = await deps.repository.findPoll(meeting.id);

    assert.equal(stored?.mode, 'meeting');
    assert.equal(stored?.noticeId, 'notice-77');
    assert.equal(stored?.protocolId, 'protocol-12');

    await deps.repository.savePoll({
      id: 'poll-survey',
      buildingId: BUILDING_ID,
      kind: 'simple',
      mode: 'survey',
      title: 'Цвет скамеек',
      question: 'Какой выбрать',
      opensAt: NOW,
      closesAt: new Date(NOW.getTime() + 3 * 24 * 3600_000),
    });

    const survey = await deps.repository.findPoll('poll-survey');

    assert.equal(survey?.mode, 'survey');
    assert.equal(survey?.noticeId, undefined);
    assert.equal(survey?.protocolId, undefined);
  });

  it('согласие с документами переживает перезапуск', async () => {
    const legalAt = new Date(NOW.getTime() - 3600_000);

    await deps.repository.saveResident({ ...author, legalVersion: '2026-09-01', legalAt });

    const stored = await deps.repository.findResident(author.id);

    assert.equal(stored?.legalVersion, '2026-09-01');
    assert.equal(stored?.legalAt?.getTime(), legalAt.getTime());

    await deps.repository.saveResident({ ...author });

    const dropped = await deps.repository.findResident(author.id);

    assert.equal(dropped?.legalVersion, undefined, 'отзыв согласия тоже сохраняется');
  });

  it('одновременное сохранение заявки не теряет событие', async () => {
    const created = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });
    const base = await deps.repository.findRequest(created.id);

    assert.ok(base);

    const fromResident = {
      ...base,
      history: [
        ...base.history,
        {
          at: new Date(NOW.getTime() + 60_000),
          status: base.status,
          role: author.role,
          actorId: author.id,
          kind: 'message' as const,
          comment: 'Течёт всё сильнее',
        },
      ],
    };

    const fromStaff = {
      ...base,
      history: [
        ...base.history,
        {
          at: new Date(NOW.getTime() + 60_000),
          status: base.status,
          role: dispatcher.role,
          actorId: dispatcher.id,
          kind: 'message' as const,
          comment: 'Мастер выехал',
        },
      ],
    };

    await Promise.all([deps.repository.saveRequest(fromResident), deps.repository.saveRequest(fromStaff)]);

    const loaded = await deps.repository.findRequest(created.id);

    assert.equal(loaded?.history.length, 3, 'обе реплики записаны');
    assert.deepEqual(
      loaded?.history.slice(1).map((event) => event.comment).sort(),
      ['Мастер выехал', 'Течёт всё сильнее'],
    );
  });

  it('одновременное сохранение не разводит колонку статуса с историей', async () => {
    if (!pool) return;

    const transactional = new PostgresRepository(fromPool(pool));
    const created = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });
    const base = await transactional.findRequest(created.id);

    assert.ok(base);

    // Смена берёт заявку в работу, жилец в ту же секунду её снимает.
    const accepted = {
      ...base,
      status: 'accepted' as const,
      assigneeId: dispatcher.id,
      history: [
        ...base.history,
        {
          at: new Date(NOW.getTime() + 60_000),
          status: 'accepted' as const,
          role: dispatcher.role,
          actorId: dispatcher.id,
        },
      ],
    };

    const withdrawn = {
      ...base,
      status: 'withdrawn' as const,
      history: [
        ...base.history,
        {
          at: new Date(NOW.getTime() + 120_000),
          status: 'withdrawn' as const,
          role: author.role,
          actorId: author.id,
        },
      ],
    };

    await Promise.all([transactional.saveRequest(accepted), transactional.saveRequest(withdrawn)]);

    const loaded = await transactional.findRequest(created.id);

    assert.equal(loaded?.history.length, 3, 'оба перехода записаны');
    assert.equal(loaded?.history.at(-1)?.status, 'withdrawn');
    assert.equal(loaded?.status, 'withdrawn', 'колонка повторяет последний переход истории');
  });

  it('повторное сохранение заявки не удваивает вложения', async () => {
    const created = await createServiceRequest(deps, {
      resident: author,
      description: 'Течёт кран',
      attachments: [
        { kind: 'photo', token: 'p1' },
        { kind: 'voice', token: 'v1' },
      ],
    });

    const base = await deps.repository.findRequest(created.id);

    assert.ok(base);

    await deps.repository.saveRequest(base);
    await deps.repository.saveRequest(base);

    const loaded = await deps.repository.findRequest(created.id);

    assert.deepEqual(
      loaded?.attachments.map((attachment) => attachment.token),
      ['p1', 'v1'],
    );
  });

  it('объявление без адресатов в базе не остаётся', async () => {
    if (!pool) return;

    const transactional = new PostgresRepository(fromPool(pool));

    await assert.rejects(
      transactional.saveAnnouncement({
        id: 'ann-broken',
        buildingId: BUILDING_ID,
        audience: { kind: 'building' },
        title: 'Отключение воды',
        body: 'С 10 до 14',
        createdAt: NOW,
        recipientIds: ['нет-такой-квартиры'],
      }),
    );

    const { rows } = await pool.query('select id from announcement where id = $1', ['ann-broken']);

    assert.deepEqual(rows, [], 'объявление без адресатов откатилось целиком');
  });

  it('сосед, ответивший «у меня работает», а потом присоединившийся, считается затронутым', async () => {
    const created = await createServiceRequest(deps, { resident: author, description: 'Нет света в подъезде' });
    const base = await deps.repository.findRequest(created.id);

    assert.ok(base);

    await deps.repository.saveRequest({
      ...base,
      notAffected: [{ residentId: neighbour.id, at: NOW }],
    });

    const answered = await deps.repository.findRequest(created.id);

    assert.ok(answered);
    assert.equal(answered.notAffected.length, 1);

    const joinedAt = new Date(NOW.getTime() + 600_000);

    await deps.repository.saveRequest({
      ...answered,
      joinedBy: [{ residentId: neighbour.id, at: joinedAt }],
    });

    const loaded = await deps.repository.findRequest(created.id);

    assert.deepEqual(loaded?.notAffected, [], 'прежний ответ больше не считается');
    assert.equal(loaded?.joinedBy.length, 1);
    assert.equal(loaded?.joinedBy[0]?.at.getTime(), joinedAt.getTime());
  });

  it('категория и срок реакции сохраняются при правке заявки', async () => {
    const created = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });
    const base = await deps.repository.findRequest(created.id);

    assert.ok(base);

    const reactionDueAt = new Date(NOW.getTime() + 30 * 60_000);

    await deps.repository.saveRequest({ ...base, category: 'heating', reactionDueAt });

    const loaded = await deps.repository.findRequest(created.id);

    assert.equal(loaded?.category, 'heating');
    assert.equal(loaded?.reactionDueAt.getTime(), reactionDueAt.getTime());
  });

  it('повторный прогон миграций ничего не ломает', async () => {
    if (!pool) return;

    const executed = await applyMigrations(fromPool(pool));

    assert.deepEqual(executed, [], 'применённые миграции пропускаются');
  });

  it('две реплики применяют одну миграцию ровно один раз', async () => {
    if (!pool) return;

    const directory = await mkdtemp(join(tmpdir(), 'domovoy-migrations-'));
    const name = '001_probe.sql';

    await writeFile(join(directory, name), 'create table probe_replicas (id text primary key);');
    await pool.query('drop table if exists probe_replicas');
    await pool.query('delete from schema_migration where name = $1', [name]);

    try {
      const [first, second] = await Promise.all([
        applyMigrations(fromPool(pool), directory),
        applyMigrations(fromPool(pool), directory),
      ]);

      assert.deepEqual([...first, ...second], [name], 'миграция применилась один раз, вторая реплика её пропустила');
    } finally {
      await pool.query('drop table if exists probe_replicas');
      await pool.query('delete from schema_migration where name = $1', [name]);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
