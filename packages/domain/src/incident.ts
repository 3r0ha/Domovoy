import { isFinal } from './status.js';
import type { AnnouncementAudience, RequestCategory, RequestTarget, ServiceRequest } from './types.js';

/** Категории, которые распространяются по общему имуществу. */
export const SHARED_INFRASTRUCTURE: readonly RequestCategory[] = [
  'plumbing',
  'heating',
  'electricity',
  'elevator',
  'safety',
];

export const isSharedInfrastructure = (category: RequestCategory): boolean =>
  SHARED_INFRASTRUCTURE.includes(category);

/** Адресат как объект заявки: обратная сторона `audienceForTarget`. */
export const audienceAsTarget = (audience: AnnouncementAudience): RequestTarget => {
  switch (audience.kind) {
    case 'riser':
      return { kind: 'riser', buildingId: audience.buildingId, entrance: audience.entrance, riser: audience.riser };
    case 'entrance':
      return { kind: 'entrance', buildingId: audience.buildingId, entrance: audience.entrance };
    case 'building':
      return { kind: 'building', buildingId: audience.buildingId };
  }
};

/** Поднимает заявку с квартиры на общее имущество. */
export const promoteToShared = (request: ServiceRequest, audience: AnnouncementAudience): ServiceRequest =>
  request.target.kind === 'apartment' ? { ...request, target: audienceAsTarget(audience) } : request;

/** Насколько давнее обращение считается тем же самым. */
export const JOIN_WINDOW_HOURS = 24;

/** Заявка вместе с разрешённым адресом: квартиру в подъезд и стояк превращает прикладной слой. */
export interface LocatedRequest {
  request: ServiceRequest;
  /** Кого затрагивает. `null`, заявка по одной квартире, соседей не касается. */
  audience: AnnouncementAudience | null;
}

/** Пересекаются ли зоны двух обращений. */
export const audiencesOverlap = (left: AnnouncementAudience, right: AnnouncementAudience): boolean => {
  if (left.buildingId !== right.buildingId) return false;
  if (left.kind === 'building' || right.kind === 'building') return true;
  if (left.entrance !== right.entrance) return false;
  if (left.kind === 'entrance' || right.kind === 'entrance') return true;

  return left.riser === right.riser;
};

/**
 * Входит ли адрес нового обращения в зону уже открытой заявки. Пересечения
 * мало: заявка о доме целиком накрыла бы собой первую попавшуюся заявку
 * подъезда, хотя речь о разных местах.
 */
export const audienceCovers = (wide: AnnouncementAudience, narrow: AnnouncementAudience): boolean => {
  if (wide.buildingId !== narrow.buildingId) return false;
  if (wide.kind === 'building') return true;
  if (narrow.kind === 'building') return false;
  if (wide.entrance !== narrow.entrance) return false;
  if (wide.kind === 'entrance') return true;
  if (narrow.kind === 'entrance') return false;

  return wide.riser === narrow.riser;
};

export interface JoinCandidate {
  category: RequestCategory;
  audience: AnnouncementAudience | null;
  at: Date;
  /** Кто сообщает: автор уже существующей заявки к ней не присоединяется. */
  authorId: string;
}

/** Ищет открытую заявку, о которой на самом деле говорит новое обращение. */
export const findJoinable = (
  candidate: JoinCandidate,
  open: readonly LocatedRequest[],
  windowHours: number = JOIN_WINDOW_HOURS,
): ServiceRequest | undefined => {
  if (!candidate.audience) return undefined;
  if (!isSharedInfrastructure(candidate.category)) return undefined;

  const windowMs = windowHours * 3600_000;

  const matches = open.filter(({ request, audience }) => {
    if (isFinal(request.status)) return false;
    if (request.category !== candidate.category) return false;
    if (request.authorId === candidate.authorId) return false;
    if (hasReported(request, candidate.authorId)) return false;
    if (!audience || !candidate.audience) return false;
    if (!audienceCovers(audience, candidate.audience)) return false;

    // Обращение, датированное раньше самой заявки, о ней говорить не может.
    const age = candidate.at.getTime() - request.createdAt.getTime();

    return age >= 0 && age <= windowMs;
  });

  return matches.sort((left, right) => left.request.createdAt.getTime() - right.request.createdAt.getTime())[0]
    ?.request;
};

/** Сообщал ли этот человек о проблеме: как автор или как присоединившийся. */
export const hasReported = (request: ServiceRequest, residentId: string): boolean =>
  request.authorId === residentId || request.joinedBy.some((join) => join.residentId === residentId);

/** Отмечает, что о проблеме сообщил ещё один жилец. */
export const joinRequest = (request: ServiceRequest, residentId: string, at: Date): ServiceRequest => {
  if (hasReported(request, residentId)) return request;

  return { ...request, joinedBy: [...request.joinedBy, { residentId, at }] };
};

/** Ответил ли человек на вопрос «у вас тоже?», в любую сторону. */
export const hasAnswered = (request: ServiceRequest, residentId: string): boolean =>
  hasReported(request, residentId) || request.notAffected.some((check) => check.residentId === residentId);

/** Сказал ли сосед, что у него всё работает. */
export const unaffected = (request: ServiceRequest, residentId: string): boolean =>
  request.notAffected.some((check) => check.residentId === residentId);

/** Отмечает, что у соседа всё работает. */
export const markUnaffected = (request: ServiceRequest, residentId: string, at: Date): ServiceRequest => {
  if (hasAnswered(request, residentId)) return request;

  return { ...request, notAffected: [...request.notAffected, { residentId, at }] };
};

/**
 * Снимает участие человека в заявке: его присоединение и ответ по опросу.
 * Автор из своей заявки не уходит.
 */
export const leaveRequest = (request: ServiceRequest, residentId: string): ServiceRequest => {
  if (request.authorId === residentId) return request;

  const joinedBy = request.joinedBy.filter((join) => join.residentId !== residentId);
  const notAffected = request.notAffected.filter((check) => check.residentId !== residentId);

  if (joinedBy.length === request.joinedBy.length && notAffected.length === request.notAffected.length) {
    return request;
  }

  return { ...request, joinedBy, notAffected };
};

/** Кто сообщал о проблеме: автор и присоединившиеся. */
export const reporterIds = (request: ServiceRequest): string[] => [
  request.authorId,
  ...request.joinedBy.map((join) => join.residentId),
];

/** Сколько жильцов подтвердили проблему, включая автора. */
export const reportersCount = (request: ServiceRequest): number => request.joinedBy.length + 1;

/** Подтверждённая авария: о проблеме сообщили независимо несколько жильцов. */
export const CONFIRMED_INCIDENT_REPORTERS = 3;

export const isConfirmedIncident = (request: ServiceRequest): boolean =>
  reportersCount(request) >= CONFIRMED_INCIDENT_REPORTERS;

/** Со скольких поддержавших управляющая организация узнаёт об этом отдельно. */
export const SUPPORT_NOTICE_AT = 5;

/** Что показал опрос соседей. */
export type Spread = 'unknown' | 'shared' | 'local';

export interface SpreadView {
  /** Подтвердили проблему, считая автора обращения. */
  affected: number;
  /** Ответили, что у них всё работает. */
  fine: number;
  verdict: Spread;
}

/** Сколько ответов «у меня работает» нужно, чтобы заподозрить квартиру. */
export const LOCAL_EVIDENCE_ANSWERS = 2;

export const spreadOf = (request: ServiceRequest): SpreadView => {
  const affected = reportersCount(request);
  const fine = request.notAffected.length;

  if (affected > 1) return { affected, fine, verdict: 'shared' };
  if (fine >= LOCAL_EVIDENCE_ANSWERS) return { affected, fine, verdict: 'local' };

  return { affected, fine, verdict: 'unknown' };
};
