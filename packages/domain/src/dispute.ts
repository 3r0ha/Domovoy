import { statusChanges } from './status.js';
import { DomainError, type RequestEvent, type ServiceRequest } from './types.js';

/**
 * Несогласие с отказом. Отказ закрывает заявку, и заявителю остаётся или
 * смириться, или заводить такую же заявку заново. Поэтому отказ пересматривается
 * один раз: заявка возвращается в работу с объяснением заявителя, а отказ,
 * оставленный в силе, становится основанием для обращения в инспекцию.
 */

/** Сколько дней у заявителя есть на несогласие. */
export const DISPUTE_DAYS = 30;

const DAY_MS = 24 * 3600_000;

/** Когда заявку отклонили в последний раз. */
export const rejectedAt = (request: ServiceRequest): Date | undefined =>
  request.status === 'rejected' ? statusChanges(request).findLast((event) => event.status === 'rejected')?.at : undefined;

/** Причина отказа: объяснение, которое смена оставила при отклонении. */
export const rejectionReason = (request: ServiceRequest): string | undefined =>
  statusChanges(request).findLast((event) => event.status === 'rejected')?.comment;

export interface DisputeCheck {
  possible: boolean;
  reason: string;
}

/** Можно ли оспорить отказ по этой заявке. */
export const canDispute = (request: ServiceRequest, residentId: string, now: Date): DisputeCheck => {
  const at = rejectedAt(request);

  if (!at) return { possible: false, reason: 'заявку не отклоняли' };
  if (request.authorId !== residentId) return { possible: false, reason: 'оспорить отказ может только заявитель' };
  if (request.disputedAt) return { possible: false, reason: 'отказ уже пересматривали' };

  if (now.getTime() - at.getTime() > DISPUTE_DAYS * DAY_MS) {
    return { possible: false, reason: `на несогласие даётся ${DISPUTE_DAYS} дней` };
  }

  return { possible: true, reason: 'отказ можно вернуть на пересмотр' };
};

export interface DisputeInput {
  residentId: string;
  comment: string;
  at: Date;
}

/**
 * Заявитель не согласен с отказом: заявка возвращается в работу. Срок
 * выполнения отсчитывается заново от несогласия, иначе заявка оживает
 * уже просроченной, и смена отвечает за время, которое заявка стояла
 * закрытой. @throws {DomainError}
 */
export const disputeRejection = (request: ServiceRequest, input: DisputeInput): ServiceRequest => {
  const check = canDispute(request, input.residentId, input.at);

  if (!check.possible) throw new DomainError('dispute_not_allowed', `Отказ не пересматривается: ${check.reason}`);

  const said = input.comment.trim();

  if (!said) throw new DomainError('comment_required', 'Напишите, почему вы не согласны с отказом');

  const allowed = request.resolutionDueAt.getTime() - request.createdAt.getTime();

  const event: RequestEvent = {
    at: input.at,
    status: 'accepted',
    role: 'resident',
    actorId: input.residentId,
    comment: said,
  };

  return {
    ...request,
    status: 'accepted',
    disputedAt: input.at,
    resolutionDueAt: new Date(input.at.getTime() + allowed),
    history: [...request.history, event],
  };
};

/** Отказ оставлен в силе: жилец оспорил, а компания отклонила заявку снова. */
export const rejectionUpheld = (request: ServiceRequest): boolean =>
  request.status === 'rejected' && request.disputedAt !== undefined;
