import type { Translate } from '@domovoy/i18n';

import { ticketStatusKey } from './keys.js';
import { russian } from './moment.js';
import { partsIn } from './reception.js';
import { MESSAGE_MAX_LENGTH } from './status.js';
import { DEFAULT_TIME_ZONE, DomainError, type Attachment, type OriginalText } from './types.js';

/** Состояние обращения в поддержку. */
export type TicketStatus = 'open' | 'answered' | 'closed';

export const TICKET_STATUS_TITLES: Record<TicketStatus, string> = {
  open: 'ждёт ответа',
  answered: 'отвечено',
  closed: 'закрыто',
};

/** Состояние обращения словами того, кто смотрит. */
export const ticketStatusTitle = (status: TicketStatus, t: Translate = russian): string =>
  t(ticketStatusKey(status));

/** Реплика в переписке с управляющей организацией. */
export interface TicketMessage {
  at: Date;
  /** Кто написал: жилец или смена. */
  from: 'resident' | 'staff';
  authorId: string;
  /** Как зовут написавшего на момент отправки. */
  authorName?: string;
  text: string;
  attachments?: Attachment[];
  /** Исходный текст, если `text` это перевод на русский. */
  original?: OriginalText;
}

/** Вопрос жильца управляющей организации и вся переписка по нему. */
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

  return short || 'Вопрос в управляющую организацию';
};

export interface OpenTicketInput {
  id: string;
  buildingId: string;
  residentId: string;
  authorName?: string;
  text: string;
  attachments?: Attachment[];
  at: Date;
  /** Исходный текст, если `text` это перевод на русский. */
  original?: OriginalText;
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
        ...(input.original ? { original: input.original } : {}),
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
  /** Исходный текст, если `text` это перевод на русский. */
  original?: OriginalText;
}

/** Слова, из которых состоит благодарность за ответ. */
const ACKNOWLEDGEMENT_WORDS: ReadonlySet<string> = new Set([
  'спасибо',
  'благодарю',
  'понятно',
  'ясно',
  'ок',
  'окей',
  'хорошо',
  'отлично',
  'принято',
  'понял',
  'поняла',
  'ага',
  'да',
  'супер',
  'большое',
  'огромное',
  'вам',
  'все',
  'ладно',
  'договорились',
  'помогло',
  'получилось',
]);

const ACKNOWLEDGEMENT_MAX_WORDS = 8;

/** «Спасибо, понятно»: ответ принят, нового вопроса в реплике нет. */
export const isAcknowledgement = (text: string): boolean => {
  if (/[?]/u.test(text)) return false;

  const words = text
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);

  return (
    words.length > 0 && words.length <= ACKNOWLEDGEMENT_MAX_WORDS && words.every((word) => ACKNOWLEDGEMENT_WORDS.has(word))
  );
};

/**
 * Реплика в переписке. Вопрос жильца снова открывает обращение, ответ смены
 * помечает его отвеченным. Благодарность за ответ вопросом не считается:
 * обращение остаётся отвеченным. @throws {DomainError}
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

  const thanked = ticket.status === 'answered' && !reply.attachments?.length && isAcknowledgement(text);

  return {
    ...ticket,
    status: reply.from === 'staff' || thanked ? 'answered' : 'open',
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
        ...(reply.original ? { original: reply.original } : {}),
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
 * не связанному с аварией: п. 36 Правил № 416.
 */
export const SUPPORT_ANSWER_DAYS = 10;

const DAY_MS = 24 * 3600_000;

/**
 * Нерабочие праздничные дни в виде `ММ-ДД` (ТК РФ, ст. 112). Переносы выходных
 * правительство утверждает на каждый год отдельно, поэтому их здесь нет:
 * управляющая организация задаёт свой календарь, если ведёт его.
 */
export const PUBLIC_HOLIDAYS: readonly string[] = [
  '01-01',
  '01-02',
  '01-03',
  '01-04',
  '01-05',
  '01-06',
  '01-07',
  '01-08',
  '02-23',
  '03-08',
  '05-01',
  '05-09',
  '06-12',
  '11-04',
];

/** Рабочий ли это день по календарю дома. */
const isWorkingDay = (at: Date, timeZone: string, holidays: readonly string[]): boolean => {
  const local = partsIn(at, timeZone);
  const date = `${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;

  return local.weekday <= 5 && !holidays.includes(date);
};

/**
 * Дата через столько рабочих дней: выходные и праздники пропускаются. День
 * недели берётся по календарю дома, иначе ночь субботы по местному времени ещё
 * пятница по UTC и срок съезжает на сутки. Ноль рабочих дней тоже даёт рабочий
 * день: срок, назначенный на субботу, истекал бы в нерабочее время.
 */
export const addWorkingDays = (
  from: Date,
  days: number,
  timeZone: string = DEFAULT_TIME_ZONE,
  holidays: readonly string[] = PUBLIC_HOLIDAYS,
): Date => {
  const due = new Date(from.getTime());

  for (let left = days; left > 0; left -= 1) {
    do {
      due.setTime(due.getTime() + DAY_MS);
    } while (!isWorkingDay(due, timeZone, holidays));
  }

  while (!isWorkingDay(due, timeZone, holidays)) due.setTime(due.getTime() + DAY_MS);

  return due;
};

/** До какого момента положено ответить. Пусто, если обращение ответа не ждёт. */
export const answerDueAt = (
  ticket: SupportTicket,
  days = SUPPORT_ANSWER_DAYS,
  timeZone: string = DEFAULT_TIME_ZONE,
  holidays: readonly string[] = PUBLIC_HOLIDAYS,
): Date | undefined => {
  const since = waitingSince(ticket);

  return since ? addWorkingDays(since, days, timeZone, holidays) : undefined;
};

/** Срок ответа нарушен. */
export const isAnswerOverdue = (
  ticket: SupportTicket,
  now: Date,
  days = SUPPORT_ANSWER_DAYS,
  timeZone: string = DEFAULT_TIME_ZONE,
  holidays: readonly string[] = PUBLIC_HOLIDAYS,
): boolean => {
  const due = answerDueAt(ticket, days, timeZone, holidays);

  return due !== undefined && now.getTime() > due.getTime();
};

/** Порядок в списке: сначала те, что ждут ответа, внутри, свежие сверху. */
export const compareTickets = (left: SupportTicket, right: SupportTicket): number => {
  if (waitsForAnswer(left) !== waitsForAnswer(right)) return waitsForAnswer(left) ? -1 : 1;

  return right.updatedAt.getTime() - left.updatedAt.getTime();
};
