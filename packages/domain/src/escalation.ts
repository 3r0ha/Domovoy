import { CATEGORY_RULES, isReactionOverdue, isResolutionOverdue } from './sla.js';
import { describeTarget } from './audience.js';
import { rejectionUpheld } from './dispute.js';
import { formatSpan } from './moment.js';
import { isFinal } from './status.js';
import { DEFAULT_TIME_ZONE, type RequestEvent, type Role, type ServiceRequest } from './types.js';

/** Насколько нужно превысить срок выполнения, чтобы это стало поводом для жалобы. */
export const ESCALATION_OVERRUN_FACTOR = 2;

export interface EscalationCheck {
  possible: boolean;
  /** Основание жалобы человеческими словами. */
  reason: string;
}

/** Есть ли у жильца основание для обращения в жилищную инспекцию. */
export const canEscalate = (request: ServiceRequest, now: Date): EscalationCheck => {
  // Отказ, оставленный в силе после несогласия заявителя, это спор по существу,
  // а не просрочка: разрешает его надзор, а не переписка с той же компанией.
  if (rejectionUpheld(request)) {
    return { possible: true, reason: 'управляющая организация отклонила заявку повторно, заявитель с отказом не согласен' };
  }

  if (isFinal(request.status)) {
    return { possible: false, reason: 'заявка закрыта' };
  }

  if (isReactionOverdue(request, now)) {
    return {
      possible: true,
      reason: `заявка не принята в работу, срок ответа нарушен на ${formatSpan(request.reactionDueAt, now)}`,
    };
  }

  if (isResolutionOverdue(request, now)) {
    const allowed = request.resolutionDueAt.getTime() - request.createdAt.getTime();
    const spent = now.getTime() - request.createdAt.getTime();

    if (spent >= allowed * ESCALATION_OVERRUN_FACTOR) {
      // Срок берётся из заявки, а не пересчитывается по категории: в документе
      // он печатается ещё и числом, и два разных срока в одной бумаге, это
      // повод отказать по ней. Слова те же, что и человеку в переписке: «двое
      // суток» вместо «48 ч», иначе читающий считает часы в уме.
      return {
        possible: true,
        reason:
          `работы не выполнены за ${formatSpan(request.createdAt, now)} ` +
          `при назначенном сроке ${formatSpan(request.createdAt, request.resolutionDueAt)}`,
      };
    }

    return { possible: false, reason: 'срок нарушен, но превышение пока в пределах разумного' };
  }

  return { possible: false, reason: 'сроки соблюдаются' };
};

export interface ComplaintInput {
  request: ServiceRequest;
  /** Адрес дома. */
  address: string;
  /** Как зовут заявителя. */
  residentName: string;
  /** Квартира заявителя. */
  residentApartment?: number;
  managementCompany?: string;
  /** Часовой пояс дома: в документе стоят местные отметки времени. Без него время московское, и документ это подписывает. */
  timeZone?: string;
  now: Date;
  /** Как показывать участников истории. */
  actorName?: (actorId: string) => string;
}

const STATUS_WORDS: Record<string, string> = {
  new: 'зарегистрирована',
  accepted: 'принята в работу',
  in_progress: 'выполняется',
  needs_info: 'возвращена заявителю за уточнением',
  done: 'отмечена управляющей организацией как выполненная',
  confirmed: 'принята заявителем',
  rejected: 'отклонена',
};

/** Дата числами: «ДД.ММ.ГГГГ, ЧЧ:ММ». */
const official = (at: Date, timeZone: string = DEFAULT_TIME_ZONE): string =>
  at.toLocaleString('ru-RU', { timeZone, dateStyle: 'short', timeStyle: 'short' });

/** Подпись пояса, когда у дома он не задан: иначе местный читатель примет московское время за своё. */
export const MOSCOW_TIME_NOTE = '(время московское)';

/** Как называть участника, имя которого в обращении не место. */
const ROLE_WORDS: Readonly<Record<Role, string>> = {
  resident: 'житель дома',
  dispatcher: 'диспетчер',
  technician: 'мастер',
  manager: 'управляющий',
  contractor: 'подрядчик',
};

/**
 * Участник хронологии. Сотрудники отвечают за работу и названы поимённо,
 * автор называет себя сам. Сосед, сообщивший о той же проблеме, идёт ролью:
 * его имя в жалобе третьего лица не появляется.
 */
const participant = (event: RequestEvent, request: ServiceRequest, name: (actorId: string) => string): string =>
  event.role !== 'resident' || event.actorId === request.authorId ? name(event.actorId) : ROLE_WORDS[event.role];

/** Готовое обращение в жилищную инспекцию. */
export const buildComplaint = (input: ComplaintInput): string => {
  const { request, now } = input;
  const rule = CATEGORY_RULES[request.category];
  const check = canEscalate(request, now);
  const name = input.actorName ?? ((actorId: string) => actorId);

  const timeline = request.history.map(
    (event) =>
      `  ${official(event.at, input.timeZone)}: ${event.kind === 'message' ? 'сообщение' : (STATUS_WORDS[event.status] ?? event.status)}` +
      ` (${participant(event, request, name)})${event.comment ? `: ${event.comment}` : ''}`,
  );

  return [
    'В Государственную жилищную инспекцию',
    '',
    `От: ${input.residentName}`,
    `Адрес: ${input.address}${input.residentApartment === undefined ? '' : `, кв. ${input.residentApartment}`}`,
    input.managementCompany ? `Управляющая организация: ${input.managementCompany}` : null,
    '',
    `Обращение № ${request.number} от ${official(request.createdAt, input.timeZone)}` +
      (input.timeZone ? '' : ` ${MOSCOW_TIME_NOTE}`),
    `Категория: ${rule.title}. Объект: ${describeTarget(request.target)}.`,
    `Существо обращения: ${request.description}`,
    '',
    'Сроки, назначенные по обращению управляющей организацией:',
    `  реакция: до ${official(request.reactionDueAt, input.timeZone)}`,
    `  выполнение: до ${official(request.resolutionDueAt, input.timeZone)}`,
    '',
    'Хронология:',
    ...timeline,
    '',
    `Нарушение на ${official(now, input.timeZone)}: ${check.reason}.`,
    '',
    'Прошу провести проверку и принять меры в пределах компетенции.',
  ]
    .filter((line) => line !== null)
    .join('\n');
};
