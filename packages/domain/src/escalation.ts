import { CATEGORY_RULES, isReactionOverdue, isResolutionOverdue } from './sla.js';
import { describeTarget } from './audience.js';
import { isFinal } from './status.js';
import { DEFAULT_TIME_ZONE, type ServiceRequest } from './types.js';

/** Насколько нужно превысить срок выполнения, чтобы это стало поводом для жалобы. */
export const ESCALATION_OVERRUN_FACTOR = 2;

export interface EscalationCheck {
  possible: boolean;
  /** Основание жалобы человеческими словами. */
  reason: string;
}

/** Есть ли у жильца основание для обращения в жилищную инспекцию. */
export const canEscalate = (request: ServiceRequest, now: Date): EscalationCheck => {
  if (isFinal(request.status)) {
    return { possible: false, reason: 'заявка закрыта' };
  }

  if (isReactionOverdue(request, now)) {
    const late = Math.round((now.getTime() - request.reactionDueAt.getTime()) / 60_000);
    return { possible: true, reason: `заявка не принята в работу, срок реакции нарушен на ${late} мин` };
  }

  if (isResolutionOverdue(request, now)) {
    const rule = CATEGORY_RULES[request.category];
    const allowed = request.resolutionDueAt.getTime() - request.createdAt.getTime();
    const spent = now.getTime() - request.createdAt.getTime();

    if (spent >= allowed * ESCALATION_OVERRUN_FACTOR) {
      const hours = Math.round(spent / 3600_000);
      return {
        possible: true,
        reason: `работы не выполнены за ${hours} ч при назначенном сроке ${rule.resolutionHours} ч`,
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
  /** Часовой пояс дома: в документе стоят местные отметки времени. */
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

/** Готовое обращение в жилищную инспекцию. */
export const buildComplaint = (input: ComplaintInput): string => {
  const { request, now } = input;
  const rule = CATEGORY_RULES[request.category];
  const check = canEscalate(request, now);
  const name = input.actorName ?? ((actorId: string) => actorId);

  const timeline = request.history.map(
    (event) =>
      `  ${official(event.at, input.timeZone)}: ${event.kind === 'message' ? 'сообщение' : (STATUS_WORDS[event.status] ?? event.status)}` +
      ` (${name(event.actorId)})${event.comment ? `: ${event.comment}` : ''}`,
  );

  return [
    'В Государственную жилищную инспекцию',
    '',
    `От: ${input.residentName}`,
    `Адрес: ${input.address}${input.residentApartment === undefined ? '' : `, кв. ${input.residentApartment}`}`,
    input.managementCompany ? `Управляющая организация: ${input.managementCompany}` : null,
    '',
    `Обращение № ${request.number} от ${official(request.createdAt, input.timeZone)}`,
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
