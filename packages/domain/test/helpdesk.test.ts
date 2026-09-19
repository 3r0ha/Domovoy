import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SUPPORT_ANSWER_DAYS,
  addWorkingDays,
  answerDueAt,
  closeTicket,
  isAcknowledgement,
  isAnswerOverdue,
  openTicket,
  replyToTicket,
  type SupportTicket,
} from '../dist/index.js';

/** Понедельник. */
const ASKED = new Date('2026-09-07T10:00:00Z');

const asked = (at = ASKED): SupportTicket =>
  openTicket({
    id: 'tic-1',
    buildingId: 'b1',
    residentId: 'res-1',
    text: 'Когда включат отопление?',
    at,
  });

describe('срок ответа на обращение', () => {
  it('выходные в счёт не идут', () => {
    // С понедельника пять рабочих дней это следующий понедельник.
    assert.equal(addWorkingDays(ASKED, 5).toISOString(), '2026-09-14T10:00:00.000Z');
    assert.equal(addWorkingDays(new Date('2026-09-11T10:00:00Z'), 1).toISOString(), '2026-09-14T10:00:00.000Z');
  });

  it('срок не истекает в выходной, даже когда добавлять нечего', () => {
    const saturday = new Date('2026-09-12T10:00:00Z');

    assert.equal(addWorkingDays(saturday, 0).toISOString(), '2026-09-14T10:00:00.000Z');
  });

  it('новогодние каникулы срок не съедают', () => {
    // Первое января, рабочий день по календарю выходных, но не по календарю страны.
    assert.equal(
      addWorkingDays(new Date('2025-12-31T10:00:00Z'), 1).toISOString(),
      '2026-01-09T10:00:00.000Z',
    );
  });

  it('десять рабочих дней с последнего сообщения жильца', () => {
    const due = answerDueAt(asked());

    assert.equal(SUPPORT_ANSWER_DAYS, 10);
    assert.equal(due?.toISOString(), '2026-09-21T10:00:00.000Z');
  });

  it('срок считается заново от нового вопроса жильца', () => {
    const answered = replyToTicket(asked(), {
      at: new Date('2026-09-08T10:00:00Z'),
      from: 'staff',
      authorId: 'disp-1',
      text: 'Подадим тепло 25 сентября',
    });

    const again = replyToTicket({ ...answered, status: 'open' }, {
      at: new Date('2026-09-09T10:00:00Z'),
      from: 'resident',
      authorId: 'res-1',
      text: 'А по батарее в подъезде?',
    });

    assert.equal(answerDueAt(again)?.toISOString(), '2026-09-23T10:00:00.000Z');
  });

  it('отвеченное и закрытое обращение срока не имеет', () => {
    const answered = replyToTicket(asked(), {
      at: new Date('2026-09-08T10:00:00Z'),
      from: 'staff',
      authorId: 'disp-1',
      text: 'Подадим тепло 25 сентября',
    });

    assert.equal(answerDueAt(answered), undefined);
    assert.equal(answerDueAt(closeTicket(asked(), new Date('2026-09-08T10:00:00Z'))), undefined);
    assert.equal(isAnswerOverdue(answered, new Date('2026-10-01T10:00:00Z')), false);
  });

  it('просрочка наступает после срока, а не в срок', () => {
    const ticket = asked();

    assert.equal(isAnswerOverdue(ticket, new Date('2026-09-21T09:00:00Z')), false);
    assert.equal(isAnswerOverdue(ticket, new Date('2026-09-21T11:00:00Z')), true);
  });
});

describe('благодарность за ответ', () => {
  const answered = (): SupportTicket =>
    replyToTicket(asked(), {
      at: new Date('2026-09-08T10:00:00Z'),
      from: 'staff',
      authorId: 'disp-1',
      text: 'Подадим тепло 25 сентября',
    });

  const said = (ticket: SupportTicket, text: string): SupportTicket =>
    replyToTicket(ticket, { at: new Date('2026-09-08T11:00:00Z'), from: 'resident', authorId: 'res-1', text });

  it('«спасибо, понятно» вопросом не считается', () => {
    assert.equal(isAcknowledgement('Спасибо, понятно!'), true);
    assert.equal(isAcknowledgement('Ок'), true);
    assert.equal(isAcknowledgement('Большое спасибо, всё ясно.'), true);
    assert.equal(isAcknowledgement('Спасибо, а по батарее?'), false);
    assert.equal(isAcknowledgement('Спасибо, но не работает'), false);
    assert.equal(isAcknowledgement('Понятно, когда придут?'), false);
  });

  it('после благодарности обращение остаётся отвеченным, а после вопроса снова ждёт ответа', () => {
    const thanked = said(answered(), 'Спасибо, понятно');

    assert.equal(thanked.status, 'answered');
    assert.equal(thanked.messages.length, 3, 'реплика в переписке остаётся');
    assert.equal(answerDueAt(thanked), undefined);

    assert.equal(said(answered(), 'Спасибо, но не работает').status, 'open');
    assert.equal(said(asked(), 'Спасибо').status, 'open', 'без ответа смены благодарить не за что');
  });
});

describe('рабочие дни считаются по календарю дома', () => {
  /** Час ночи субботы в Москве: по UTC это ещё вечер пятницы. */
  const NIGHT = new Date('2026-09-11T22:00:00Z');

  it('ночь субботы по местному времени, это уже выходной', () => {
    assert.equal(addWorkingDays(NIGHT, 1).toISOString(), '2026-09-13T22:00:00.000Z');
    assert.equal(
      addWorkingDays(NIGHT, 1, 'UTC').toISOString(),
      '2026-09-14T22:00:00.000Z',
      'по UTC суббота начинается сутками позже',
    );
  });

  it('пояс дома доходит до срока ответа', () => {
    const ticket = asked(NIGHT);

    assert.equal(answerDueAt(ticket, 1)?.toISOString(), '2026-09-13T22:00:00.000Z');
    assert.equal(answerDueAt(ticket, 1, 'UTC')?.toISOString(), '2026-09-14T22:00:00.000Z');
    assert.equal(isAnswerOverdue(ticket, new Date('2026-09-14T00:00:00Z'), 1), true);
    assert.equal(isAnswerOverdue(ticket, new Date('2026-09-14T00:00:00Z'), 1, 'UTC'), false);
  });

  it('за Уралом выходные начинаются раньше, чем в Москве', () => {
    // Пятница 20:00 по Москве, но во Владивостоке уже суббота.
    const evening = new Date('2026-09-11T17:00:00Z');

    assert.equal(addWorkingDays(evening, 1).toISOString(), '2026-09-14T17:00:00.000Z');
    assert.equal(addWorkingDays(evening, 1, 'Asia/Vladivostok').toISOString(), '2026-09-13T17:00:00.000Z');
  });
});
