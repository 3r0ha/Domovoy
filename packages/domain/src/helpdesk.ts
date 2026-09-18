import { partsIn } from './reception.js';
import { MESSAGE_MAX_LENGTH } from './status.js';
import { DEFAULT_TIME_ZONE, DomainError, type Attachment } from './types.js';

/** Состояние обращения в поддержку. */
export type TicketStatus = 'open' | 'answered' | 'closed';

export const TICKET_STATUS_TITLES: Record<TicketStatus, string> = {
  open: 'ждёт ответа',
  answered: 'отвечено',
  closed: 'закрыто',
};

/** Реплика в переписке с управляющей компанией. */
export interface TicketMessage {
  at: Date;
  /** Кто написал: жилец или смена. */
  from: 'resident' | 'staff';
  authorId: string;
  /** Как зовут написавшего на момент отправки. */
  authorName?: string;
  text: string;
  attachments?: Attachment[];
}

/** Вопрос жильца управляющей компании и вся переписка по нему. */
export interface SupportTicket {
  id: string;
  buildingId: string;
  /** Кто спросил. */
  residentId: string;
  /** О чём вопрос: первая строка первого сообщения. */
  subject: string;
  status: TicketStatus;
  createdAt: Date;
  /** Когда в переписке появилась последняя реплика. */
  updatedAt: Date;
  messages: TicketMessage[];
}

/** Тема обращения: первая фраза вопроса. */
const subjectOf = (text: string): string => {
  const line = text.trim().split('\n')[0] ?? '';
  const short = line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;

  return short || 'Вопрос в управляющую компанию';
};

export interface OpenTicketInput {
  id: string;
  buildingId: string;
  residentId: string;
  authorName?: string;
  text: string;
  attachments?: Attachment[];
  at: Date;
}

/** Новое обращение с первым сообщением. @throws {DomainError} */
export const openTicket = (input: OpenTicketInput): SupportTicket => {
  const text = input.text.trim();

  if (text.length === 0) throw new DomainError('message_empty', 'Напишите вопрос');
  if (text.length > MESSAGE_MAX_LENGTH) {
    throw new DomainError('message_too_long', `Вопрос длиннее ${MESSAGE_MAX_LENGTH} знаков`);
  }

  return {
    id: input.id,
    buildingId: input.buildingId,
    residentId: input.residentId,
    subject: subjectOf(text),
    status: 'open',
    createdAt: input.at,
    updatedAt: input.at,
    messages: [
      {
        at: input.at,
        from: 'resident',
        authorId: input.residentId,
        ...(input.authorName ? { authorName: input.authorName } : {}),
        text,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      },
    ],
  };
};

export interface TicketReply {
  from: 'resident' | 'staff';
  authorId: string;
  authorName?: string;
  text: string;
  attachments?: Attachment[];
  at: Date;
}

/**
 * Реплика в переписке. Вопрос жильца снова открывает обращение, ответ смены
 * помечает его отвеченным. @throws {DomainError}
 */
export const replyToTicket = (ticket: SupportTicket, reply: TicketReply): SupportTicket => {
  const text = reply.text.trim();

  if (text.length === 0) throw new DomainError('message_empty', 'Сообщение пустое');
  if (text.length > MESSAGE_MAX_LENGTH) {
    throw new DomainError('message_too_long', `Сообщение длиннее ${MESSAGE_MAX_LENGTH} знаков`);
  }

  if (ticket.status === 'closed') {
    throw new DomainError('ticket_closed', 'Обращение закрыто, задайте вопрос заново');
  }

  return {
    ...ticket,
    status: reply.from === 'staff' ? 'answered' : 'open',
    updatedAt: reply.at,
    messages: [
      ...ticket.messages,
      {
        at: reply.at,
        from: reply.from,
        authorId: reply.authorId,
        ...(reply.authorName ? { authorName: reply.authorName } : {}),
        text,
        ...(reply.attachments?.length ? { attachments: reply.attachments } : {}),
      },
    ],
  };
};

/** Обращение закрыто: переписка по нему больше не продолжается. */
export const closeTicket = (ticket: SupportTicket, at: Date): SupportTicket =>
  ticket.status === 'closed' ? ticket : { ...ticket, status: 'closed', updatedAt: at };

/** Ждёт ли обращение ответа смены. */
export const waitsForAnswer = (ticket: SupportTicket): boolean => ticket.status === 'open';

/** С какого момента обращение ждёт ответа: с последнего сообщения жильца. */
export const waitingSince = (ticket: SupportTicket): Date | undefined => {
  if (!waitsForAnswer(ticket)) return undefined;

  return [...ticket.messages].reverse().find((message) => message.from === 'resident')?.at ?? ticket.createdAt;
};

/**
 * Сколько рабочих дней есть у организации на письменный ответ по обращению,
 * не связанному с аварией: п. 36 Правил № 416. Праздники здесь не учитываются,
 * считаются суббота и воскресенье.
 */
export const SUPPORT_ANSWER_DAYS = 10;

const DAY_MS = 24 * 3600_000;

/**
 * Дата через столько рабочих дней: выходные пропускаются. День недели берётся
 * по календарю дома, иначе ночь субботы по местному времени ещё пятница по UTC
 * и срок съезжает на сутки.
 */
export const addWorkingDays = (from: Date, days: number, timeZone: string = DEFAULT_TIME_ZONE): Date => {
  const due = new Date(from.getTime());

  for (let left = days; left > 0; left -= 1) {
    do {
      due.setTime(due.getTime() + DAY_MS);
    } while (partsIn(due, timeZone).weekday > 5);
  }

  return due;
};

/** До какого момента положено ответить. Пусто, если обращение ответа не ждёт. */
export const answerDueAt = (
  ticket: SupportTicket,
  days = SUPPORT_ANSWER_DAYS,
  timeZone: string = DEFAULT_TIME_ZONE,
): Date | undefined => {
  const since = waitingSince(ticket);

  return since ? addWorkingDays(since, days, timeZone) : undefined;
};

/** Срок ответа нарушен. */
export const isAnswerOverdue = (
  ticket: SupportTicket,
  now: Date,
  days = SUPPORT_ANSWER_DAYS,
  timeZone: string = DEFAULT_TIME_ZONE,
): boolean => {
  const due = answerDueAt(ticket, days, timeZone);

  return due !== undefined && now.getTime() > due.getTime();
};

/** Порядок в списке: сначала те, что ждут ответа, внутри, свежие сверху. */
export const compareTickets = (left: SupportTicket, right: SupportTicket): number => {
  if (waitsForAnswer(left) !== waitsForAnswer(right)) return waitsForAnswer(left) ? -1 : 1;

  return right.updatedAt.getTime() - left.updatedAt.getTime();
};
