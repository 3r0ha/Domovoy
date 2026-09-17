import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  announceIncident,
  announceResolved,
  createCollectingNotifier,
  createServiceRequest,
  formatStatusChange,
  publishAnnouncement,
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

const otherEntrance: Resident = {
  id: 'res-3',
  maxUserId: 3003,
  displayName: 'Пётр',
  role: 'resident',
  apartmentId: 'apt-3',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Диспетчер',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const setup = () => {
  const notifier = createCollectingNotifier();
  let counter = 0;

  const deps: AppDeps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: APARTMENTS,
      residents: [author, neighbour, otherEntrance, dispatcher],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
  };

  return { deps, notifier };
};

describe('уведомления о заявке', () => {
  it('автор узнаёт, что заявку приняли', async () => {
    const { deps, notifier } = setup();
    const request = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'accepted' });

    assert.equal(notifier.sent.length, 1);
    assert.equal(notifier.sent[0]?.maxUserId, author.maxUserId);
    assert.match(notifier.sent[0]?.text ?? '', /Заявка Д15-2609-0001 принята в работу/);
  });

  it('причина отказа доходит до жильца', async () => {
    const { deps, notifier } = setup();
    const request = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'rejected',
      comment: 'Не относится к общему имуществу',
    });

    assert.match(notifier.sent[0]?.text ?? '', /Не относится к общему имуществу/);
  });

  it('свои же действия жильцу не пересказываются', async () => {
    const { deps, notifier } = setup();
    const request = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'needs_info',
      comment: 'Когда удобно прийти?',
    });

    const before = notifier.sent.length;
    await transitionRequest(deps, {
      resident: author,
      requestId: request.id,
      to: 'in_progress',
      comment: 'После 18:00',
    });

    assert.equal(notifier.sent.length, before, 'жилец сам ответил, извещать его не о чем');
  });

  it('текст уведомления содержит номер, категорию и объект', async () => {
    const { deps } = setup();
    const request = await createServiceRequest(deps, {
      resident: author,
      description: 'Лифт застрял',
      startParam: 'eqp_b1_lift-2',
    });

    const text = formatStatusChange(request);

    assert.match(text, /Заявка Д15-2609-0001/);
    assert.match(text, /Лифт, оборудование lift-2/);
  });
});

describe('уведомления об объявлении', () => {
  it('доходят только до затронутых квартир', async () => {
    const { deps, notifier } = setup();

    const published = await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Отключение воды',
      body: 'Завтра с 9 до 14',
      entrance: 1,
      riser: 2,
    });

    assert.equal(published.notified, 1);
    assert.deepEqual(
      notifier.sent.map((item) => item.maxUserId),
      [neighbour.maxUserId],
      'сосед по стояку получил, остальные, нет',
    );
    assert.match(notifier.sent[0]?.text ?? '', /Отключение воды/);
  });

  it('объявление всему дому доходит до всех жильцов', async () => {
    const { deps, notifier } = setup();

    const published = await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Собрание',
      body: 'В субботу во дворе',
    });

    assert.equal(published.notified, 3);
    assert.equal(notifier.sent.length, 3);
  });

  it('общедомовое объявление попадает и в чат дома', async () => {
    const { deps, notifier } = setup();

    await deps.repository.saveBuilding({ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', chatId: 777 });

    await publishAnnouncement(deps, { resident: dispatcher, title: 'Собрание', body: 'В субботу во дворе' });

    assert.deepEqual(notifier.posted, [{ chatId: 777, text: 'Собрание\n\nВ субботу во дворе' }]);
    assert.equal(notifier.sent.length, 3);
  });

  it('объявление по стояку в общий чат не идёт: остальным это шум', async () => {
    const { deps, notifier } = setup();

    await deps.repository.saveBuilding({ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', chatId: 777 });

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Отключение воды',
      body: 'Завтра с 9 до 14',
      entrance: 1,
      riser: 2,
    });

    assert.deepEqual(notifier.posted, []);
  });

  it('авария висит наверху чата, пока её не устранят', async () => {
    const { deps, notifier } = setup();

    await deps.repository.saveBuilding({ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', chatId: 777 });

    const request = await createServiceRequest(deps, {
      resident: author,
      description: 'Нет холодной воды во всём доме',
      category: 'plumbing',
    });

    await announceIncident(deps, { ...request, target: { kind: 'building', buildingId: BUILDING_ID } });

    assert.equal(notifier.pinned.length, 1, 'объявление об аварии не закреплено');
    assert.equal(notifier.pinned[0]?.chatId, 777);

    await announceResolved(deps, { ...request, target: { kind: 'building', buildingId: BUILDING_ID } });

    assert.deepEqual(notifier.unpinned, [777], 'устранённая авария осталась закреплённой');
    assert.equal(notifier.posted.length, 2, 'о начале и об устранении сказано по разу');
  });

  it('без привязанного чата ничего не ломается', async () => {
    const { deps, notifier } = setup();

    await publishAnnouncement(deps, { resident: dispatcher, title: 'Собрание', body: 'В субботу' });

    assert.deepEqual(notifier.posted, []);
    assert.equal(notifier.sent.length, 3);
  });

  it('квартиры без жильцов охват не раздувают', async () => {
    const { deps, notifier } = setup();

    const published = await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Ремонт кровли',
      body: 'Начинаем в понедельник',
      entrance: 2,
    });

    assert.equal(published.announcement.recipientIds.length, 1, 'квартира в подъезде одна');
    assert.equal(published.notified, 1);
    assert.equal(notifier.sent[0]?.maxUserId, otherEntrance.maxUserId);
  });
});

describe('без канала уведомлений', () => {
  it('сценарии работают, ничего не отправляя', async () => {
    const { deps } = setup();
    const withoutNotifier: AppDeps = { ...deps, notifier: undefined };

    const request = await createServiceRequest(deps, { resident: author, description: 'Течёт кран' });

    await assert.doesNotReject(
      transitionRequest(withoutNotifier, { resident: dispatcher, requestId: request.id, to: 'accepted' }),
    );
  });
});
