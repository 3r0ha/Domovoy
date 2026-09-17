import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '@domovoy/domain';

import {
  InMemoryRepository,
  answerSupport,
  askSupport,
  closeSupport,
  contactsFor,
  describeTickets,
  createCollectingNotifier,
  formatContacts,
  formatTicket,
  listSupportFor,
  supportTicket,
  updateBuilding,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const OTHER_ID = 'b2';
const NOW = new Date('2026-09-07T10:00:00Z');

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
  maxUserId: 5005,
  displayName: 'Ольга Титова',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const manager: Resident = {
  id: 'man-1',
  maxUserId: 5006,
  displayName: 'Нина Гордеева',
  role: 'manager',
  buildingId: BUILDING_ID,
};

/** Диспетчер соседней компании: её дома нашего не касаются. */
const stranger: Resident = {
  id: 'disp-2',
  maxUserId: 5007,
  displayName: 'Пётр',
  role: 'dispatcher',
  buildingId: OTHER_ID,
};

const setup = () => {
  let counter = 0;
  const notifier = createCollectingNotifier();

  const deps: AppDeps = {
    repository: new InMemoryRepository({
      buildings: [
        { id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', companyId: 'uk-1' },
        { id: OTHER_ID, code: 'Д1', address: 'ул. Мира, 1', companyId: 'uk-2' },
      ],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
      ],
      residents: [maria, ivan, dispatcher, manager, stranger],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
  };

  return { deps, notifier };
};

describe('вопрос в управляющую компанию', () => {
  it('вопрос жильца доходит до смены и ждёт ответа', async () => {
    const { deps, notifier } = setup();

    const ticket = await askSupport(deps, { resident: maria, text: 'Когда включат отопление в подъезде?' });

    assert.equal(ticket.status, 'open');
    assert.equal(ticket.subject, 'Когда включат отопление в подъезде?');
    assert.equal(ticket.messages.length, 1);

    const sent = notifier.sent.filter((message) => message.text.includes('Вопрос в поддержку'));

    assert.equal(sent.length, 2, 'узнали диспетчер и управляющий');
    assert.equal(sent[0]?.answerAbout, ticket.id, 'ответить можно прямо из уведомления');
  });

  it('ответ смены приходит жильцу, а обращение помечается отвеченным', async () => {
    const { deps, notifier } = setup();

    const asked = await askSupport(deps, { resident: maria, text: 'Когда включат отопление?' });
    const answered = await answerSupport(deps, {
      staff: dispatcher,
      ticketId: asked.id,
      text: 'Подадим тепло 25 сентября, по графику города.',
    });

    assert.equal(answered.status, 'answered');
    assert.equal(answered.messages.length, 2);
    assert.equal(answered.messages[1]?.authorName, 'Ольга Титова');

    const toResident = notifier.sent.find((message) => message.maxUserId === maria.maxUserId);

    assert.match(toResident?.text ?? '', /Подадим тепло 25 сентября/);
  });

  it('жилец продолжает ту же переписку, и вопрос снова ждёт ответа', async () => {
    const { deps } = setup();

    const asked = await askSupport(deps, { resident: maria, text: 'Когда включат отопление?' });
    await answerSupport(deps, { staff: dispatcher, ticketId: asked.id, text: '25 сентября.' });

    const again = await askSupport(deps, { resident: maria, text: 'А батарею в комнате кто настроит?', ticketId: asked.id });

    assert.equal(again.id, asked.id, 'переписка одна');
    assert.equal(again.status, 'open');
    assert.equal(again.messages.length, 3);
  });

  it('чужое обращение соседу не видно', async () => {
    const { deps } = setup();

    const asked = await askSupport(deps, { resident: maria, text: 'Вопрос про квитанцию' });

    await assert.rejects(supportTicket(deps, ivan, asked.id), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, 'forbidden');
      return true;
    });
  });

  it('смена соседней организации в чужую переписку не попадает', async () => {
    const { deps } = setup();

    const asked = await askSupport(deps, { resident: maria, text: 'Вопрос про уборку' });

    await assert.rejects(supportTicket(deps, stranger, asked.id), /другая управляющая организация/);
  });

  it('отвечает смена, а не сосед', async () => {
    const { deps } = setup();

    const asked = await askSupport(deps, { resident: maria, text: 'Вопрос про воду' });

    await assert.rejects(
      answerSupport(deps, { staff: ivan, ticketId: asked.id, text: 'Я знаю ответ' }),
      /управляющая компания/,
    );
  });

  it('закрытое обращение переписку больше не принимает', async () => {
    const { deps } = setup();

    const asked = await askSupport(deps, { resident: maria, text: 'Вопрос решён сам' });
    const closed = await closeSupport(deps, maria, asked.id);

    assert.equal(closed.status, 'closed');

    await assert.rejects(
      askSupport(deps, { resident: maria, text: 'ещё одно слово', ticketId: asked.id }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'ticket_closed');
        return true;
      },
    );
  });

  it('смена видит вопросы всего дома, жилец, только свои', async () => {
    const { deps } = setup();

    await askSupport(deps, { resident: maria, text: 'Вопрос Марии' });
    await askSupport(deps, { resident: ivan, text: 'Вопрос Ивана' });

    const forStaff = await listSupportFor(deps, dispatcher);
    const forResident = await listSupportFor(deps, maria);

    assert.equal(forStaff.length, 2);
    assert.deepEqual(
      forResident.map((ticket) => ticket.subject),
      ['Вопрос Марии'],
    );
  });

  it('ждущие ответа идут первыми', async () => {
    const { deps } = setup();

    const first = await askSupport(deps, { resident: maria, text: 'Первый вопрос' });
    await askSupport(deps, { resident: ivan, text: 'Второй вопрос' });
    await answerSupport(deps, { staff: dispatcher, ticketId: first.id, text: 'Ответ на первый' });

    const queue = await listSupportFor(deps, dispatcher);

    assert.deepEqual(
      queue.map((ticket) => ticket.subject),
      ['Второй вопрос', 'Первый вопрос'],
    );
  });

  it('смене видно, кто спросил и сколько вопрос ждёт', async () => {
    const { deps } = setup();

    const asked = await askSupport(deps, { resident: maria, text: 'Когда включат отопление?' });
    const [card] = await describeTickets(deps, [asked]);

    assert.ok(card);
    assert.equal(card.authorName, 'Мария');
    assert.equal(card.apartment, 1);
    assert.equal(card.waitingSince?.getTime(), NOW.getTime());

    const later = new Date(NOW.getTime() + 3 * 3600_000);

    assert.match(formatTicket(card, { viewerId: dispatcher.id, now: later }), /Мария, кв\. 1 · ждёт 3 ч/);
  });

  it('отвеченный вопрос ответа больше не ждёт', async () => {
    const { deps } = setup();

    const asked = await askSupport(deps, { resident: maria, text: 'Вопрос про воду' });
    const answered = await answerSupport(deps, { staff: dispatcher, ticketId: asked.id, text: 'Ответ' });
    const [card] = await describeTickets(deps, [answered]);

    assert.ok(card);
    assert.equal(card.waitingSince, undefined);
    assert.match(formatTicket(card, { viewerId: dispatcher.id, now: NOW }), /Мария, кв\. 1 · отвечено/);
  });

  it('переписка словами показывает обе стороны', async () => {
    const { deps } = setup();

    const asked = await askSupport(deps, { resident: maria, text: 'Когда уберут подъезд?' });
    const answered = await answerSupport(deps, { staff: dispatcher, ticketId: asked.id, text: 'Завтра до полудня.' });

    const [card] = await describeTickets(deps, [answered]);

    assert.ok(card);

    const forResident = formatTicket(card, { viewerId: maria.id });
    const forStaff = formatTicket(card, { viewerId: dispatcher.id });

    assert.match(forResident, /Когда уберут подъезд\?/);
    assert.match(forResident, /Вы, /);
    assert.match(forResident, /Ольга Титова/);
    assert.match(forResident, /Завтра до полудня/);
    assert.match(forStaff, /Мария, кв\. 1/, 'смене видно, кто спросил и из какой квартиры');
  });
});

describe('срок ответа на обращение', () => {
  it('смена видит срок и просрочку по обращению', async () => {
    const { deps } = setup();

    const ticket = await askSupport(deps, { resident: maria, text: 'Когда включат отопление?' });

    const [inTime] = await describeTickets(deps, [ticket]);
    const [late] = await describeTickets({ ...deps, now: () => new Date('2026-09-22T10:00:00Z') }, [ticket]);

    assert.equal(inTime?.answerDueAt?.toISOString(), '2026-09-21T10:00:00.000Z');
    assert.equal(inTime?.overdue, undefined);
    assert.equal(late?.overdue, true);
  });

  it('у отвеченного обращения срока нет', async () => {
    const { deps } = setup();

    const ticket = await askSupport(deps, { resident: maria, text: 'Когда включат отопление?' });
    const answered = await answerSupport(deps, { staff: dispatcher, ticketId: ticket.id, text: 'Подадим 25 сентября' });

    const [card] = await describeTickets({ ...deps, now: () => new Date('2026-10-01T10:00:00Z') }, [answered]);

    assert.equal(card?.answerDueAt, undefined);
    assert.equal(card?.overdue, undefined);
  });
});

describe('к кому обращаться по дому', () => {
  it('управляющий записывает ответственного, и его видит жилец', async () => {
    const { deps } = setup();

    await updateBuilding(deps, manager, {
      contact: {
        name: 'Гордеева Нина Павловна',
        role: 'управляющая домом',
        phone: '+7 900 120-45-15',
        email: 'nina@uk.ru',
      },
    });

    const contacts = await contactsFor(deps, maria);

    assert.equal(contacts.contact?.name, 'Гордеева Нина Павловна');
    assert.equal(contacts.contact?.phone, '+7 900 120-45-15');
    assert.match(formatContacts(contacts), /nina@uk\.ru/);
  });

  it('почта с опечаткой не сохраняется', async () => {
    const { deps } = setup();

    await assert.rejects(
      updateBuilding(deps, manager, { contact: { name: 'Нина', email: 'нина собака почта' } }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'email_invalid');
        return true;
      },
    );
  });

  it('дежурного видно вместе с контактами', async () => {
    const { deps } = setup();

    await deps.repository.saveResident({ ...dispatcher, onDuty: true, phone: '+7 900 000-11-22' });

    const contacts = await contactsFor(deps, maria);

    assert.equal(contacts.duty?.displayName, 'Ольга Титова');
    assert.match(formatContacts(contacts), /Дежурит сейчас: Ольга Титова/);
  });

  it('аварийная служба, режим работы и приём доходят до жильца', async () => {
    const { deps } = setup();

    await updateBuilding(deps, manager, {
      service: {
        emergencyPhone: '+7 900 120-00-15',
        phone: '+7 900 120-45-00',
        hours: 'пн-пт 9:00-18:00',
        office: 'ул. Ленина, 15, офис 1',
        officeHours: 'вт и чт 15:00-19:00',
      },
    });

    const contacts = await contactsFor(deps, maria);
    const text = formatContacts(contacts);

    assert.equal(contacts.service?.emergencyPhone, '+7 900 120-00-15');
    assert.match(text, /Авария, круглосуточно: \+7 900 120-00-15/);
    assert.match(text, /Телефон: \+7 900 120-45-00 · пн-пт 9:00-18:00/);
    assert.match(text, /Приём: ул\. Ленина, 15, офис 1 · вт и чт 15:00-19:00/);
    assert.ok(text.split('\n').length <= 7, `контакты в чате слишком длинные: ${text}`);
  });

  it('пустое поле убирает сведение, остальные остаются', async () => {
    const { deps } = setup();

    await updateBuilding(deps, manager, { service: { emergencyPhone: '+7 900 120-00-15', hours: 'круглосуточно' } });
    await updateBuilding(deps, manager, { service: { hours: '' } });

    const contacts = await contactsFor(deps, maria);

    assert.equal(contacts.service?.emergencyPhone, '+7 900 120-00-15');
    assert.equal(contacts.service?.hours, undefined);
  });

  it('карточку дома без сведений оставляют как была', async () => {
    const { deps } = setup();

    await updateBuilding(deps, manager, { service: { emergencyPhone: '+7 900 120-00-15' } });
    await updateBuilding(deps, manager, { address: 'ул. Ленина, 15' });

    assert.equal((await contactsFor(deps, maria)).service?.emergencyPhone, '+7 900 120-00-15');
  });

  it('контакты чужого дома закрыты', async () => {
    const { deps } = setup();

    await assert.rejects(contactsFor(deps, maria, OTHER_ID), /другая управляющая организация/);
  });
});
