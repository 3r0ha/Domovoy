import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  buildingReport,
  contactsFor,
  createCollectingNotifier,
  listAnnouncementsFor,
  listPollsFor,
  listRequestsFor,
  listSupportFor,
  type AppDeps,
} from '@domovoy/app';

import { demoData, seedDemo } from '../dist/demo.js';
import { runWalkthrough } from '../dist/walkthrough.js';

const deps = (): AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> } => {
  const notifier = createCollectingNotifier();
  let counter = 0;

  return {
    repository: new InMemoryRepository(),
    now: () => new Date('2026-09-03T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: demoData().buildingId,
    notifier,
  };
};

describe('демонстрационные данные', () => {
  it('заводят дом, квартиры и участников', async () => {
    const app = deps();
    const data = await seedDemo(app);

    assert.equal((await app.repository.listApartments(data.buildingId)).length, 12);
    assert.equal((await app.repository.findResidentByMaxUserId(1001))?.displayName, 'Мария');
    assert.equal((await app.repository.findResidentByMaxUserId(2001))?.role, 'dispatcher');
  });

  it('очередь показывает заявки в разных состояниях', async () => {
    const app = deps();
    const data = await seedDemo(app, { withRequests: true });

    const dispatcher = data.residents.find((resident) => resident.role === 'dispatcher');
    const queue = await listRequestsFor(app, dispatcher!, 'queue');

    assert.deepEqual(
      [...new Set(queue.map((request) => request.status))].sort(),
      ['done', 'in_progress', 'needs_info', 'new'],
    );
    assert.equal(queue.length, 7);
  });

  it('подрядчику видны только его наряды, а не очередь дома', async () => {
    const app = deps();
    const data = await seedDemo(app, { withRequests: true });

    const contractor = data.residents.find((resident) => resident.role === 'contractor');

    const own = await listRequestsFor(app, contractor!, 'mine');

    assert.equal(own.length, 1);
    assert.match(own[0]?.description ?? '', /Лифт/);

    assert.deepEqual(
      (await listRequestsFor(app, contractor!, 'queue')).map((request) => request.id),
      own.map((request) => request.id),
    );
  });

  it('сводка по дому непустая: есть авария, возврат и проблемный объект', async () => {
    const app = deps();
    const data = await seedDemo(app, { withRequests: true });

    const dispatcher = data.residents.find((resident) => resident.role === 'dispatcher');
    const report = await buildingReport(app, dispatcher!);

    assert.equal(report.summary.mergedReports, 1, 'обращение соседки склеено');
    assert.equal(report.incidents.length, 1);
    assert.equal(report.objects[0]?.title, 'Лифт, подъезд 1', 'лифт ломается чаще прочего');
    assert.equal(report.assignees[0]?.reopened, 1, 'одну работу жилец не принял');

    assert.ok(report.period.created > 0, 'за месяц что-то подано');
    assert.ok(report.period.closed > 0, 'и что-то закрыто');
    assert.ok(report.previous.created > 0, 'есть с чем сравнить');

    assert.ok(
      report.categories.some((category) => category.overdue > 0),
      'в истории дома есть нарушенный норматив',
    );
  });

  it('обращение соседки присоединяется к заявке, а не удваивает её', async () => {
    const app = deps();
    const data = await seedDemo(app, { withRequests: true });

    const joined = (await app.repository.listRequests({})).find(
      (request) => request.number === data.joinedRequestNumber,
    );

    assert.equal(data.reporters, 2);
    assert.deepEqual(
      joined?.joinedBy.map((join) => join.residentId),
      ['res-anna'],
    );
    assert.equal(joined?.authorId, 'res-ivan');
  });

  it('одна заявка ждёт приёмки жильцом', async () => {
    const app = deps();
    await seedDemo(app, { withRequests: true });

    const waiting = (await app.repository.listRequests({ statuses: ['done'] }))[0];

    assert.match(waiting?.description ?? '', /лампа/i);
    assert.equal(waiting?.history.at(-1)?.comment, 'Лампа заменена');
  });

  it('аварийная заявка стоит первой в очереди', async () => {
    const app = deps();
    const data = await seedDemo(app, { withRequests: true });

    const dispatcher = data.residents.find((resident) => resident.role === 'dispatcher');
    const queue = await listRequestsFor(app, dispatcher!, 'queue');
    const stuck = queue.find((request) => request.priority === 'emergency' && /застряли/iu.test(request.description));

    // Авария посева уже в работе у мастера, чтобы за день показа не краснеть:
    // в очереди она видна, а первыми стоят заявки, которые ещё ждут смены.
    assert.equal(stuck?.status, 'in_progress');
    assert.ok(stuck?.assigneeId, 'аварийная заявка без исполнителя');
    assert.equal(queue[0]?.status, 'new');
  });

  it('заявки создаются обычными сценариями, а не записью в базу', async () => {
    const app = deps();
    await seedDemo(app, { withRequests: true });

    const requests = await app.repository.listRequests({});
    const withHistory = requests.find((request) => request.status === 'in_progress');

    assert.deepEqual(
      withHistory?.history.map((event) => event.status),
      ['new', 'accepted', 'in_progress'],
    );
    assert.equal(withHistory?.assigneeId, 'staff-technician');
  });

  it('жильцы получают уведомления, как в жизни', async () => {
    const app = deps();
    await seedDemo(app, { withRequests: true });

    assert.ok(app.notifier.sent.length > 0, 'смена статуса дошла до авторов');
    assert.ok(
      app.notifier.sent.some((item) => /ждёт вашего уточнения/.test(item.text)),
      'вопрос мастера доехал до жильца',
    );
  });

  it('объявления показывают адресную рассылку', async () => {
    const app = deps();
    await seedDemo(app, { withRequests: true });

    const maria = (await app.repository.findResidentByMaxUserId(1001))!;
    const ivan = (await app.repository.findResidentByMaxUserId(1002))!;

    const forMaria = await listAnnouncementsFor(app, maria);
    const forIvan = await listAnnouncementsFor(app, ivan);

    assert.deepEqual(
      forMaria.map((item) => item.title).sort(),
      ['Отключение горячей воды', 'Промывка системы отопления', 'Собрание собственников'],
    );
    assert.equal(forIvan.length, 4);
  });

  it('у каждой квартиры есть счётчики с историей', async () => {
    const app = deps();
    const data = await seedDemo(app, { withRequests: true });

    for (const apartment of data.apartments) {
      const meters = await app.repository.listMeters(apartment.id);

      assert.equal(meters.length, 3, `нет счётчиков у ${apartment.id}`);
    }

    const readings = await app.repository.listReadings('cold_water-apt-1');

    assert.equal(readings.length, 6);
    assert.equal(readings[0]?.value, 137.1, 'свежие впереди');
  });

  it('идёт собрание с недобранным кворумом', async () => {
    const app = deps();
    const data = await seedDemo(app, { withRequests: true });

    const ivan = data.residents.find((resident) => resident.id === 'res-ivan');
    const polls = await listPollsFor(app, ivan!);
    const view = polls.find((item) => item.poll.title === 'Ремонт подъездов');

    assert.equal(view?.open, true);
    assert.equal(view?.result.totalArea, 458);
    assert.equal(view?.result.votedArea, 40, 'квартира Ивана, 40 м²');
    assert.equal(view?.result.quorum, false);
    // Дом 458 м², кворум больше половины: голосу Ивана не хватает 189 м².
    assert.equal(view?.areaToQuorum, 189);

    // Рядом идёт опрос жильцов: он не собрание и решения не принимает.
    const survey = polls.find((item) => item.poll.mode === 'survey');

    assert.equal(survey?.open, true);
    assert.equal(survey?.poll.title, 'Уборка подъездов по субботам');
  });

  it('в поддержке есть отвеченный вопрос и ждущий ответа', async () => {
    const app = deps();
    const data = await seedDemo(app, { withRequests: true });

    const dispatcher = data.residents.find((resident) => resident.role === 'dispatcher');
    const queue = await listSupportFor(app, dispatcher!);

    assert.deepEqual(
      queue.map((ticket) => ticket.status),
      ['open', 'answered'],
      'ждущий ответа стоит первым',
    );
    assert.equal(queue[1]?.messages.length, 2);
  });

  it('ответственного по дому видит жилец', async () => {
    const app = deps();
    const data = await seedDemo(app);

    const maria = data.residents.find((resident) => resident.id === 'res-maria');
    const contacts = await contactsFor(app, maria!);

    assert.equal(contacts.contact?.name, data.contact.name);
    assert.equal(contacts.contact?.phone, data.contact.phone);
  });

  it('повторный запуск ничего не ломает', async () => {
    const app = deps();

    await seedDemo(app);
    await assert.doesNotReject(seedDemo(app));

    assert.equal((await app.repository.listApartments(demoData().buildingId)).length, 12);
  });
});

describe('сквозной прогон', () => {
  it('играет сценарий целиком через настоящего бота', async () => {
    const lines = await runWalkthrough({ log: () => undefined });
    // Знаки разметки в расшифровке не проверяются: человек видит начертание.
    const transcript = lines.map((line) => `${line.who}: ${line.text}`).join('\n').replace(/\*\*/gu, '');

    assert.match(transcript, /вы обратились по объекту: подъезд 1, стояк 2/);
    assert.match(transcript, /бот → Ольга Титова, диспетчер: Новая заявка/);
    assert.match(transcript, /Авария: /);
    assert.match(transcript, /Записал: у вас то же самое/);
    assert.match(transcript, /Подтвердили 1, у 0 всё работает/);
    assert.match(transcript, /ждёт вашей приёмки/);
    assert.match(transcript, /Что именно не сделано/);
    assert.match(transcript, /Обращений присоединено к существующим заявкам: 1/);
    assert.match(transcript, /Принято: 140,2 м³/, 'показания подаются тем же ботом');
    assert.match(transcript, /Холодная вода на общие нужды дома/, 'общедомовое в квитанции');
    assert.match(transcript, /Перерасчёт: горячая вода отключали дольше нормы/, 'перерыв сверх нормы снижает плату');
    assert.match(transcript, /Старый долг за \d+ месяц\S*: .*штраф за просрочку /, 'долг и штраф видны в квитанции');
    assert.match(transcript, /Домофон, подъезд 1: открыто/, 'дверь открывается тем же ботом');
    assert.match(transcript, /Оплачено/, 'квитанция оплачивается тем же ботом');
    assert.match(transcript, /Квалифицированное большинство/, 'собрание считается по долям');
    assert.match(transcript, /Голос квартиры: за/);
    assert.match(transcript, /Свободных часов/, 'приём открывается из переписки, а часы выбирают в приложении');

    assert.match(transcript, /бот → чат дома: Чат привязан к дому/);
    assert.match(transcript, /бот → чат дома: Заявка Д15/, 'заявка из чата видна соседям');
    assert.match(transcript, /Сообщений от бота за это время: 0/, 'бот влез в разговор соседей');
    assert.match(transcript, /бот → чат дома: Иван, ответил вам лично/);

    assert.match(transcript, /Вопрос в поддержку, пишет Анна/, 'вопрос в управляющую компанию');
    assert.match(transcript, /Лавочку поставим/, 'смена ответила кнопкой под вопросом');
    assert.match(transcript, /Наклейка «Подъезд 1»/, 'наклейка приходит в переписку файлом');
    assert.match(transcript, /Рассылка собирается в приложении/, 'списки и формы уходят на экран');
    assert.match(transcript, /Дежурство принято/);

    const toAnna = lines.filter((line) => line.who.includes('Анна')).length;

    assert.ok(toAnna >= 4, `Анне ушло только ${toAnna} сообщений`);
  });
});
