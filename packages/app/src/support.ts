import {
  DomainError,
  OPEN_STATUSES,
  SUPPORT_NOTICE_AT,
  audienceForTarget,
  describeTarget,
  hasReported,
  isConfirmedIncident,
  isFinal,
  isInAudience,
  joinRequest,
  reportersCount,
  type Apartment,
  type ServiceRequest,
} from '@domovoy/domain';

import { noopNotifier, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

interface Home {
  apartment: Apartment | undefined;
  buildingId: string | undefined;
}

/** Квартира жильца и дом, к которому он относится. */
const homeOf = async (deps: AppDeps, resident: Resident): Promise<Home> => {
  const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;

  return { apartment, buildingId: apartment?.buildingId ?? resident.buildingId };
};

/** Заявка про дом жильца и про ту его часть, где он живёт. */
const concerns = (request: ServiceRequest, home: Home): boolean => {
  if (!home.buildingId || request.buildingId !== home.buildingId) return false;

  const audience = audienceForTarget(request.target);

  if (!audience) return false;
  if (audience.kind === 'building') return true;

  return home.apartment ? isInAudience(home.apartment, audience) : false;
};

/**
 * Заявки по общему имуществу, которые касаются этого жильца и заведены не им.
 * Двор, освещение и уборка не считаются аварией.
 */
export const supportableFor = async (deps: AppDeps, resident: Resident): Promise<ServiceRequest[]> => {
  const home = await homeOf(deps, resident);

  if (!home.buildingId) return [];

  const open = await deps.repository.listRequests({ buildingId: home.buildingId, statuses: [...OPEN_STATUSES] });

  return open.filter((request) => {
    if (request.target.kind === 'apartment') return false;
    if (hasReported(request, resident.id)) return false;
    if (request.priority === 'emergency' || isConfirmedIncident(request)) return false;

    return concerns(request, home);
  });
};

export interface SupportResult {
  request: ServiceRequest;
  /** Сколько жильцов за этой заявкой, считая автора. */
  reporters: number;
}

/** «У меня то же самое» по неаварийной заявке. @throws {DomainError} */
export const supportRequest = async (
  deps: AppDeps,
  resident: Resident,
  requestId: string,
): Promise<SupportResult> => {
  const found = await deps.repository.findRequest(requestId);

  if (!found) throw new DomainError('request_not_found', 'Заявка не найдена');
  if (isFinal(found.status)) throw new DomainError('request_closed', `Заявка ${found.number} уже закрыта`);

  if (found.target.kind === 'apartment') {
    throw new DomainError('forbidden', 'Заявку по чужой квартире поддержать нельзя');
  }

  if (hasReported(found, resident.id)) return { request: found, reporters: reportersCount(found) };

  // Присоединение даёт доступ к переписке и статусам заявки, поэтому отбор тот же,
  // что и в списке предлагаемых: чужой дом и чужой подъезд не поддерживают.
  if (!concerns(found, await homeOf(deps, resident))) {
    throw new DomainError('forbidden', 'Эта заявка не про ваш дом');
  }

  const saved = await deps.repository.saveRequest(joinRequest(found, resident.id, deps.now()));
  const reporters = reportersCount(saved);

  if (reporters === SUPPORT_NOTICE_AT) {
    const notifier = deps.notifier ?? noopNotifier;
    const text =
      `Заявку ${saved.number} поддержали ${reporters} жильцов.\n` +
      `${saved.title}\n${describeTarget(saved.target)}`;

    for (const person of await deps.repository.listStaff(saved.buildingId)) {
      await notifyResident(notifier, person, text, [], saved.id);
    }
  }

  return { request: saved, reporters };
};
