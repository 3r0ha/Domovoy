import {
  closeTicket,
  compareTickets,
  DomainError,
  formatMoment,
  formatSpan,
  isCompanyStaff,
  onCall,
  openTicket,
  replyToTicket,
  TICKET_STATUS_TITLES,
  WORKING_HOURS,
  answerDueAt,
  isAnswerOverdue,
  waitingSince,
  waitsForAnswer,
  type Attachment,
  type SupportTicket,
} from '@domovoy/domain';

import type { Translate } from '@domovoy/i18n';

import { assertServes, homeBuildingOf } from './buildings.js';
import { speak, speakDefault } from './language.js';
import { noopNotifier, notifyResident } from './notifier.js';
import { rememberResidents } from './people.js';
import type { Resident } from './repository.js';
import { assertSaid } from './said.js';
import { intoLanguage, intoRussian, withOriginal } from './translation.js';
import type { AppDeps } from './use-cases.js';
import { zoneOf } from './zone.js';

export interface AskSupportCommand {
  resident: Resident;
  text: string;
  attachments?: Attachment[];
  /** Продолжение переписки по уже открытому обращению. */
  ticketId?: string;
}

/** Сколько обращений отдаём за раз. */
export const SUPPORT_PAGE = 20;

/** Кому в доме идут вопросы жильцов. */
const staffOf = async (deps: AppDeps, buildingId: string): Promise<Resident[]> => {
  const own = await deps.repository.listStaff(buildingId);
  const responsible = own.length > 0 ? own : await deps.repository.listManagers();

  return onCall(responsible, deps.now(), WORKING_HOURS, await zoneOf(deps, buildingId));
};

/** Вопрос в управляющую компанию: новое обращение или реплика в открытом. @throws {DomainError} */
export const askSupport = async (deps: AppDeps, command: AskSupportCommand): Promise<SupportTicket> => {
  // Смена читает вопрос по-русски, поэтому перевод идёт до проверки сказанного:
  // по делу ли вопрос, решается по тому же тексту, который увидит человек в смене.
  const told = await intoRussian(deps, command.resident.language, command.text);

  await assertSaid(deps, told.text, {
    asked: 'вопрос в управляющую организацию',
    hint: 'Напишите вопрос словами.',
    role: command.resident.role,
    ...(command.attachments?.length ? { attachments: command.attachments } : {}),
  });

  const { resident } = command;
  const buildingId = await homeBuildingOf(deps, resident);
  const now = deps.now();

  const known = command.ticketId ? await supportTicket(deps, resident, command.ticketId) : undefined;

  const ticket = known
    ? replyToTicket(known, {
        from: 'resident',
        authorId: resident.id,
        authorName: resident.displayName,
        text: told.text,
        ...(command.attachments?.length ? { attachments: command.attachments } : {}),
        at: now,
        ...(told.original ? { original: told.original } : {}),
      })
    : openTicket({
        id: deps.createId(),
        buildingId,
        residentId: resident.id,
        authorName: resident.displayName,
        text: told.text,
        ...(command.attachments?.length ? { attachments: command.attachments } : {}),
        at: now,
        ...(told.original ? { original: told.original } : {}),
      });

  const saved = await deps.repository.saveSupportTicket(ticket);

  // Благодарность за ответ вопроса не открывает: смене о ней сообщать нечего.
  if (!waitsForAnswer(saved)) return saved;

  const notifier = deps.notifier ?? noopNotifier;
  const last = saved.messages.at(-1)?.text ?? '';
  // Ответ даётся кнопкой из самого уведомления, поэтому команду называть незачем.
  const text = withOriginal(
    `Вопрос в поддержку, пишет ${resident.displayName}: «${saved.subject}»` +
      (last === saved.subject ? '' : `\n${last}`),
    told.original,
  );

  for (const person of await staffOf(deps, saved.buildingId)) {
    if (person.id === resident.id) continue;

    await notifyResident(notifier, person, text, [], { answerAbout: saved.id });
  }

  return saved;
};

export interface AnswerSupportCommand {
  staff: Resident;
  ticketId: string;
  text: string;
  attachments?: Attachment[];
}

/** Ответ смены жильцу. @throws {DomainError} */
export const answerSupport = async (deps: AppDeps, command: AnswerSupportCommand): Promise<SupportTicket> => {
  const { staff } = command;

  if (!isCompanyStaff(staff.role)) {
    throw new DomainError('forbidden', 'Отвечает в поддержке управляющая компания');
  }

  const ticket = await supportTicket(deps, staff, command.ticketId);
  const now = deps.now();

  const saved = await deps.repository.saveSupportTicket(
    replyToTicket(ticket, {
      from: 'staff',
      authorId: staff.id,
      authorName: staff.displayName,
      text: command.text,
      ...(command.attachments?.length ? { attachments: command.attachments } : {}),
      at: now,
    }),
  );

  const asked = await deps.repository.findResident(saved.residentId);

  // Ответ переводится до доставки: жилец читает его на своём языке, а канал
  // уведомлений получает готовый текст.
  const answer = await intoLanguage(deps, asked, command.text.trim());

  // Жилец подписан именем, и ответ ему приходит так же: он видит, с кем говорит.
  await notifyResident(
    deps.notifier ?? noopNotifier,
    asked,
    speak(asked)('app.support.answered', {
      сотрудник: staff.displayName,
      тема: saved.subject,
      текст: answer,
    }),
    [],
    { answerAbout: saved.id },
  );

  return saved;
};

/** Обращение закрывает тот, кто спросил, или смена дома. @throws {DomainError} */
export const closeSupport = async (
  deps: AppDeps,
  resident: Resident,
  ticketId: string,
): Promise<SupportTicket> => {
  const ticket = await supportTicket(deps, resident, ticketId);

  return deps.repository.saveSupportTicket(closeTicket(ticket, deps.now()));
};

/** Обращение с проверкой права его видеть. @throws {DomainError} */
export const supportTicket = async (
  deps: AppDeps,
  resident: Resident,
  ticketId: string,
): Promise<SupportTicket> => {
  const ticket = await deps.repository.findSupportTicket(ticketId);

  if (!ticket) throw new DomainError('ticket_not_found', 'Обращение не найдено');

  if (ticket.residentId === resident.id) return ticket;

  if (!isCompanyStaff(resident.role)) throw new DomainError('forbidden', 'Это чужое обращение');

  await assertServes(deps, resident, ticket.buildingId);

  return ticket;
};

/**
 * Обращения человека: жилец видит свои, смена, все вопросы дома, и те, что
 * ждут ответа, идут первыми.
 */
export const listSupportFor = async (
  deps: AppDeps,
  resident: Resident,
  limit = SUPPORT_PAGE,
): Promise<SupportTicket[]> => {
  const found = isCompanyStaff(resident.role)
    ? await deps.repository.listSupportTickets({ buildingId: resident.buildingId ?? deps.defaultBuildingId })
    : await deps.repository.listSupportTickets({ residentId: resident.id });

  return [...found].sort(compareTickets).slice(0, limit);
};

/** Сколько вопросов дома ждут ответа: число для значка смены. */
export const waitingSupport = async (deps: AppDeps, buildingId: string): Promise<number> =>
  (await deps.repository.listSupportTickets({ buildingId, statuses: ['open'] })).length;

/** Обращение с тем, что смене нужно до открытия переписки: кто спросил и сколько ждёт. */
export interface TicketCard {
  ticket: SupportTicket;
  authorName?: string;
  /** Номер квартиры спросившего: по нему смена узнаёт, о чём речь. */
  apartment?: number;
  /** С какого момента вопрос ждёт ответа. */
  waitingSince?: Date;
  /** До какого момента положено ответить: п. 36 Правил № 416. */
  answerDueAt?: Date;
  /** Срок ответа нарушен. */
  overdue?: boolean;
}

/** Дописывает к обращениям имя, квартиру и время ожидания. */
export const describeTickets = async (deps: AppDeps, tickets: SupportTicket[]): Promise<TicketCard[]> => {
  const readResident = rememberResidents(deps);
  const flats = new Map<string, number | undefined>();

  const numberOf = async (apartmentId: string | undefined): Promise<number | undefined> => {
    if (!apartmentId) return undefined;

    if (!flats.has(apartmentId)) {
      flats.set(apartmentId, (await deps.repository.findApartment(apartmentId))?.number);
    }

    return flats.get(apartmentId);
  };

  const cards: TicketCard[] = [];

  for (const ticket of tickets) {
    const author = await readResident(ticket.residentId);
    const apartment = await numberOf(author?.apartmentId);
    const since = waitingSince(ticket);
    const due = answerDueAt(ticket);

    cards.push({
      ticket,
      ...(author?.displayName ? { authorName: author.displayName } : {}),
      ...(apartment === undefined ? {} : { apartment }),
      ...(since ? { waitingSince: since } : {}),
      ...(due ? { answerDueAt: due } : {}),
      ...(isAnswerOverdue(ticket, deps.now()) ? { overdue: true } : {}),
    });
  }

  return cards;
};

/** Кто спросил, одной строкой: «Мария, кв. 1». */
export const describeAsker = (card: TicketCard): string =>
  [card.authorName ?? 'Жилец', card.apartment === undefined ? '' : `кв. ${card.apartment}`]
    .filter(Boolean)
    .join(', ');

export interface TicketTextOptions {
  zone?: string;
  /** Кто читает: его собственные реплики подписаны «Вы». */
  viewerId?: string;
  /** Сейчас: от него считается, сколько вопрос ждёт ответа. */
  now?: Date;
  /** Язык читающего. Без него переписка показывается по-русски. */
  t?: Translate;
}

/** Вторая строка переписки: жильцу о состоянии, смене о том, кто спросил и сколько ждёт. */
const ticketState = (card: TicketCard, options: TicketTextOptions, t: Translate): string => {
  const waiting = card.waitingSince && options.now ? `ждёт ${formatSpan(card.waitingSince, options.now)}` : '';

  if (card.ticket.residentId === options.viewerId) {
    return waitsForAnswer(card.ticket) ? t('app.support.waiting') : '';
  }

  return [describeAsker(card), waiting || TICKET_STATUS_TITLES[card.ticket.status]].filter(Boolean).join(' · ');
};

/** Сколько последних сообщений показывает переписка: остальное открывают в приложении. */
const SHOWN_MESSAGES = 6;

/** Переписка словами: так её показывает бот. */
export const formatTicket = (card: TicketCard, options: TicketTextOptions = {}): string => {
  const { zone, viewerId } = options;
  const { ticket } = card;
  const t = options.t ?? speakDefault();

  // Тема повторяет начало первого сообщения, поэтому в переписке её не показываем.
  const lines = [ticketState(card, options, t), ''].filter((line) => line !== '');

  // Длинная переписка в сообщение не помещается: видны последние реплики,
  // а начало остаётся в приложении.
  const shown = ticket.messages.slice(-SHOWN_MESSAGES);

  if (shown.length < ticket.messages.length) {
    lines.push(t('app.support.earlier', { сколько: ticket.messages.length - shown.length }), '');
  }

  for (const message of shown) {
    const who =
      message.authorId === viewerId
        ? t('app.support.you')
        : (message.authorName ?? t(message.from === 'staff' ? 'app.support.company' : 'app.support.resident'));

    // Автор читает свой текст, остальные, перевод с пометкой и оригиналом.
    const said =
      message.authorId === viewerId && message.original
        ? message.original.text
        : withOriginal(message.text, message.original);

    lines.push(`${who}, ${formatMoment(message.at, zone)}:`, said, '');
  }

  return lines.join('\n').trimEnd();
};
