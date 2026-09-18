import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError, momentIn } from '@domovoy/domain';

import {
  InMemoryRepository,
  createCollectingNotifier,
  dropVisit,
  formatVisit,
  listAudit,
  listVisitsFor,
  markVisitDone,
  receptionFor,
  recordVisit,
  setReception,
  takeVisit,
  updateBuilding,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const ZONE = 'Asia/Yekaterinburg';

/** Понедельник, 21 сентября 2026 года, 10 утра по дому. */
const NOW = momentIn({ year: 2026, month: 9, day: 21, hour: 10, minute: 0 }, ZONE);

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const ivan: Resident = {
  id: 'res-2',
  maxUserId: 1002,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 2001,
  displayName: 'Ольга Титова',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const manager: Resident = {
  id: 'man-1',
  maxUserId: 2003,
  displayName: 'Нина Гордеева',
  role: 'manager',
  buildingId: BUILDING_ID,
};

const setup = async (withReception = true) => {
  let counter = 0;
  const notifier = createCollectingNotifier();

  const deps: AppDeps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', timeZone: ZONE }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
      ],
      residents: [maria, ivan, dispatcher, manager],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
  };

  if (withReception) {
    await updateBuilding(deps, manager, {
      reception: [
        { weekday: 2, from: '15:00', to: '17:00' },
        { weekday: 4, from: '15:00', to: '16:00' },
      ],
      service: { office: 'ул. Ленина, 15, офис 1' },
    });
  }

  return { deps, notifier };
};

describe('запись на приём', () => {
  it('жилец видит свободные часы и адрес приёма', async () => {
    const { deps } = await setup();

    const reception = await receptionFor(deps, maria);

    assert.equal(reception.minutes, 30);
    assert.equal(reception.office, 'ул. Ленина, 15, офис 1');
    assert.equal(reception.mine, undefined);
    // Вторник: четыре получаса, четверг: два, и так две недели.
    assert.equal(reception.slots.length, 12);
  });

  it('запись занимает время и уходит смене', async () => {
    const { deps, notifier } = await setup();

    const slots = (await receptionFor(deps, maria)).slots;
    const visit = await takeVisit(deps, { resident: maria, at: slots[0]!, topic: 'Перерасчёт за воду' });

    assert.equal(visit.status, 'booked');
    assert.equal(visit.minutes, 30);

    const after = await receptionFor(deps, maria);

    assert.equal(after.mine?.id, visit.id);
    assert.equal(after.slots.length, slots.length - 1);

    const sent = notifier.sent.filter((message) => message.text.includes('Запись на приём'));

    assert.equal(sent.length, 2, 'узнали диспетчер и управляющий');
    assert.match(sent[0]?.text ?? '', /Мария: Перерасчёт за воду/);
  });

  it('второй жилец на то же время не встанет', async () => {
    const { deps } = await setup();

    const slots = (await receptionFor(deps, maria)).slots;

    await takeVisit(deps, { resident: maria, at: slots[0]!, topic: 'Перерасчёт' });

    await assert.rejects(
      takeVisit(deps, { resident: ivan, at: slots[0]!, topic: 'Тот же час' }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'slot_taken');
        return true;
      },
    );
  });

  it('одновременные записи на один час не занимают его дважды', async () => {
    const { deps } = await setup();

    const at = (await receptionFor(deps, maria)).slots[0]!;

    // Оба считают свободные часы до того, как кто-то из них сохранится.
    const [first, second] = await Promise.allSettled([
      takeVisit(deps, { resident: maria, at, topic: 'Перерасчёт' }),
      takeVisit(deps, { resident: ivan, at, topic: 'Тот же час' }),
    ]);

    const failed = [first, second].filter((outcome) => outcome.status === 'rejected');

    assert.equal(failed.length, 1, 'один записался, второй нет');
    assert.equal((failed[0] as PromiseRejectedResult).reason instanceof DomainError, true);
    assert.equal(((failed[0] as PromiseRejectedResult).reason as DomainError).code, 'slot_taken');

    const booked = await deps.repository.listVisits({ buildingId: BUILDING_ID, statuses: ['booked'] });

    assert.equal(booked.length, 1, 'в доме осталась одна запись на этот час');
  });

  it('вторая запись того же человека не заводится', async () => {
    const { deps } = await setup();

    const slots = (await receptionFor(deps, maria)).slots;

    await takeVisit(deps, { resident: maria, at: slots[0]!, topic: 'Перерасчёт' });

    await assert.rejects(takeVisit(deps, { resident: maria, at: slots[1]!, topic: 'И ещё' }), /уже есть запись/);
  });

  it('без приёмных окон записаться нельзя', async () => {
    const { deps } = await setup(false);

    const reception = await receptionFor(deps, maria);

    assert.deepEqual(reception.windows, []);
    assert.deepEqual(reception.slots, []);

    await assert.rejects(
      takeVisit(deps, { resident: maria, at: NOW, topic: 'Вопрос' }),
      /не ведёт приём по записи/,
    );
  });

  it('жилец отменяет свою запись, и время освобождается', async () => {
    const { deps } = await setup();

    const slots = (await receptionFor(deps, maria)).slots;
    const visit = await takeVisit(deps, { resident: maria, at: slots[0]!, topic: 'Перерасчёт' });

    const cancelled = await dropVisit(deps, maria, visit.id);

    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await receptionFor(deps, maria)).slots.length, slots.length);
  });

  it('чужую запись жилец не отменит', async () => {
    const { deps } = await setup();

    const slots = (await receptionFor(deps, maria)).slots;
    const visit = await takeVisit(deps, { resident: maria, at: slots[0]!, topic: 'Перерасчёт' });

    await assert.rejects(dropVisit(deps, ivan, visit.id), /не найдена/);
  });

  it('смена видит записи дома с именем и квартирой', async () => {
    const { deps, notifier } = await setup();

    const slots = (await receptionFor(deps, maria)).slots;
    const visit = await takeVisit(deps, { resident: maria, at: slots[0]!, topic: 'Перерасчёт' });

    const cards = await listVisitsFor(deps, dispatcher);

    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.residentName, 'Мария');
    assert.equal(cards[0]?.apartment, 1);

    await dropVisit(deps, dispatcher, visit.id);

    const told = notifier.sent.filter((message) => message.text.includes('отменён управляющей организацией'));

    assert.equal(told.length, 1, 'жилец узнал об отмене');
    assert.equal((await listVisitsFor(deps, dispatcher)).length, 0);
  });

  it('запись читается одной строкой: день, время и тема', async () => {
    const { deps } = await setup();

    const slots = (await receptionFor(deps, maria)).slots;
    const visit = await takeVisit(deps, { resident: maria, at: slots[0]!, topic: 'Перерасчёт за воду' });

    assert.equal(formatVisit(visit, ZONE), '22 сентября, 15:00: Перерасчёт за воду');
  });

  it('состоявшийся приём отмечает смена', async () => {
    const { deps } = await setup();

    const slots = (await receptionFor(deps, maria)).slots;
    const visit = await takeVisit(deps, { resident: maria, at: slots[0]!, topic: 'Перерасчёт' });

    const done = await markVisitDone(deps, dispatcher, visit.id);

    assert.equal(done.status, 'done');
    await assert.rejects(markVisitDone(deps, maria, visit.id), /Приём отмечает управляющая организация/);
  });
});

describe('приёмные часы дома', () => {
  it('смена задаёт часы приёма, и в доме появляются свободные часы', async () => {
    const { deps } = await setup(false);

    assert.deepEqual((await receptionFor(deps, maria)).slots, []);

    const reception = await setReception(deps, {
      staff: dispatcher,
      windows: [{ weekday: 2, from: '15:00', to: '17:00' }],
      minutes: 60,
    });

    assert.equal(reception.minutes, 60);
    assert.deepEqual(reception.windows, [{ weekday: 2, from: '15:00', to: '17:00' }]);
    assert.equal(reception.slots.length, 4, 'два вторника по два часа приёма');

    const [entry] = await listAudit(deps, manager);

    assert.equal(entry?.action, 'reception_changed');
    assert.match(entry?.subject ?? '', /вторник 15:00-17:00/);
  });

  it('пустые часы убирают приём по записи', async () => {
    const { deps } = await setup();

    const reception = await setReception(deps, { staff: dispatcher, windows: [] });

    assert.deepEqual(reception.windows, []);
    assert.deepEqual(reception.slots, []);
    await assert.rejects(
      takeVisit(deps, { resident: maria, at: NOW, topic: 'Перерасчёт' }),
      /не ведёт приём по записи/,
    );
  });

  it('часы задаёт смена своего дома, а не жилец', async () => {
    const { deps } = await setup();

    await assert.rejects(
      setReception(deps, { staff: maria, windows: [{ weekday: 2, from: '15:00', to: '17:00' }] }),
      /Приём ведёт управляющая организация/,
    );

    await assert.rejects(
      setReception(deps, {
        staff: dispatcher,
        buildingId: 'b2',
        windows: [{ weekday: 2, from: '15:00', to: '17:00' }],
      }),
      DomainError,
    );
  });

  it('час приёма не задаётся наоборот', async () => {
    const { deps } = await setup();

    await assert.rejects(
      setReception(deps, { staff: dispatcher, windows: [{ weekday: 2, from: '17:00', to: '15:00' }] }),
      /заканчивается позже/,
    );
  });
});

describe('запись пришедшего сотрудником', () => {
  it('пришедшего без записи записывают состоявшимся приёмом', async () => {
    const { deps, notifier } = await setup();

    const visit = await recordVisit(deps, {
      staff: dispatcher,
      residentId: maria.id,
      topic: 'Принесла показания на бумаге',
    });

    assert.equal(visit.status, 'done', 'приём уже состоялся');
    assert.equal(visit.at.getTime(), NOW.getTime());
    assert.equal(notifier.sent.length, 0, 'человеку у стойки сообщать нечего');

    const entry = (await listAudit(deps, manager)).find((item) => item.action === 'visit_recorded');

    assert.match(entry?.details ?? '', /Мария: Принесла показания на бумаге/);
  });

  it('запись на будущее занимает время и доходит до жильца', async () => {
    const { deps, notifier } = await setup();

    const slots = (await receptionFor(deps, maria)).slots;

    const visit = await recordVisit(deps, {
      staff: dispatcher,
      residentId: maria.id,
      at: slots[0]!,
      topic: 'Перерасчёт за воду',
    });

    assert.equal(visit.status, 'booked');
    assert.equal((await receptionFor(deps, maria)).slots.length, slots.length - 1);
    assert.equal(notifier.sent.filter((message) => /записала вас на приём/.test(message.text)).length, 1);
  });

  it('записывает только смена своего дома и только известного человека', async () => {
    const { deps } = await setup();

    await assert.rejects(
      recordVisit(deps, { staff: maria, residentId: ivan.id, topic: 'Перерасчёт' }),
      /Приём ведёт управляющая организация/,
    );

    await assert.rejects(
      recordVisit(deps, { staff: dispatcher, residentId: 'res-нет', topic: 'Перерасчёт' }),
      /не найден/,
    );
  });

  it('запись без темы не принимается', async () => {
    const { deps } = await setup();

    await assert.rejects(recordVisit(deps, { staff: dispatcher, residentId: maria.id, topic: '  ' }), /с чем/);
  });
});
