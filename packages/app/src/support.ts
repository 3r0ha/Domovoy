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
  type ServiceRequest,
} from '@domovoy/domain';

import { noopNotifier, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/**
 * Заявки по общему имуществу, которые касаются этого жильца и заведены не им.
 * Двор, освещение и уборка не считаются аварией.
 */
export const supportableFor = async (deps: AppDeps, resident: Resident): Promise<ServiceRequest[]> => {
  const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;
  const buildingId = apartment?.buildingId ?? resident.buildingId;

  if (!buildingId) return [];

  const open = await deps.repository.listRequests({ buildingId, statuses: [...OPEN_STATUSES] });

  return open.filter((request) => {
    if (request.target.kind === 'apartment') return false;
    if (hasReported(request, resident.id)) return false;
    if (request.priority === 'emergency' || isConfirmedIncident(request)) return false;

    const audience = audienceForTarget(request.target);

    if (!audience) return false;
    if (audience.kind === 'building') return true;

    return apartment ? isInAudience(apartment, audience) : false;
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
