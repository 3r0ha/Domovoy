import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SUPPORT_ANSWER_DAYS,
  addWorkingDays,
  answerDueAt,
  closeTicket,
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
