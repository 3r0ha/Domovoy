import {
  buildComplaint,
  canEscalate,
  DomainError,
  hasReported,
  isCompanyStaff,
  type ServiceRequest,
} from '@domovoy/domain';

import { apartmentIn } from '../apartments.js';
import { servedBy } from '../buildings.js';
import { type Resident } from '../repository.js';
import { type AppDeps } from '../use-cases.js';
import { zoneOf } from '../zone.js';

export interface EscalationOffer {
  possible: boolean;
  reason: string;
  /** Готовый текст обращения. Есть только когда основание действительно есть. */
  complaint?: string;
}

/** Обращение в жилинспекцию доступно автору и подтвердившим соседям. */
const canRequestComplaint = (resident: Resident, request: ServiceRequest): boolean =>
  hasReported(request, resident.id);

const assertReporter = (resident: Resident, request: ServiceRequest): void => {
  if (!canRequestComplaint(resident, request)) {
    throw new DomainError('forbidden', 'Обращение может составить только заявитель');
  }
};

/** Обращение в жилинспекцию: текст собирается из истории заявки. */
export const escalationFor = async (
  deps: AppDeps,
  resident: Resident,
  requestId: string,
): Promise<EscalationOffer> => {
  const request = await deps.repository.findRequest(requestId);

  if (!request) throw new DomainError('request_not_found', 'Заявка не найдена');

  assertReporter(resident, request);

  if (isCompanyStaff(resident.role) && servedBy(resident, deps).includes(request.buildingId)) {
    return {
      possible: false,
      reason: 'обращение в жилищную инспекцию составляет заявитель, а не управляющая компания',
    };
  }

  const now = deps.now();
  const check = canEscalate(request, now);

  if (!check.possible) return { possible: false, reason: check.reason };

  const building = await deps.repository.findBuilding(request.buildingId);
  const home = await apartmentIn(deps, resident, request.buildingId);
  const participants = new Map<string, string>();

  for (const event of request.history) {
    if (participants.has(event.actorId)) continue;

    const actor = await deps.repository.findResident(event.actorId);
    participants.set(event.actorId, actor?.displayName ?? event.actorId);
  }

  return {
    possible: true,
    reason: check.reason,
    complaint: buildComplaint({
      request,
      address: building?.address || 'адрес не указан',
      residentName: resident.displayName,
      ...(home ? { residentApartment: home.number } : {}),
      ...(building?.managementCompany ? { managementCompany: building.managementCompany } : {}),
      timeZone: await zoneOf(deps, request.buildingId),
      now,
      actorName: (actorId) => participants.get(actorId) ?? actorId,
    }),
  };
};
