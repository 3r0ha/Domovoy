import {
  HANDOFF_TITLES,
  addMessage,
  buildComplaint,
  canEscalate,
  DomainError,
  handoffDueAt,
  hasReported,
  isCompanyStaff,
  type Handoff,
  type ServiceRequest,
} from '@domovoy/domain';

import { apartmentIn } from '../apartments.js';
import { servedBy } from '../buildings.js';
import { MANUAL_CHANNEL } from '../handoff.js';
import { speak } from '../language.js';
import { noopNotifier, notifyResident } from '../notifier.js';
import { rememberResidents } from '../people.js';
import { type Resident } from '../repository.js';
import { type AppDeps } from '../use-cases.js';

export interface EscalationOffer {
  possible: boolean;
  reason: string;
  /** Готовый текст обращения. Есть только когда основание действительно есть. */
  complaint?: string;
  /** Обращение уже отправлено: второй раз его не шлют. */
  sent?: { externalId?: string; dueAt: Date; organization: string };
}

/** Обращение в жилинспекцию доступно автору и подтвердившим соседям. */
const canRequestComplaint = (resident: Resident, request: ServiceRequest): boolean =>
  hasReported(request, resident.id);

const assertReporter = (resident: Resident, request: ServiceRequest): void => {
  if (!canRequestComplaint(resident, request)) {
    throw new DomainError('forbidden', 'Обращение может составить только заявитель');
  }
};

/** @throws {DomainError} */
const requestOf = async (deps: AppDeps, requestId: string): Promise<ServiceRequest> => {
  const request = await deps.repository.findRequest(requestId);

  if (!request) throw new DomainError('request_not_found', 'Заявка не найдена');

  return request;
};

/** Обращение в жилинспекцию по уже прочитанной заявке. */
const offerFor = async (deps: AppDeps, resident: Resident, request: ServiceRequest): Promise<EscalationOffer> => {
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
  const personOf = rememberResidents(deps);
  const participants = new Map<string, string>();

  for (const actorId of new Set(request.history.map((event) => event.actorId))) {
    participants.set(actorId, (await personOf(actorId))?.displayName ?? actorId);
  }

  const sent = (await deps.repository.listHandoffs({ requestId: request.id })).find(
    (handoff) => handoff.byResident === true && handoff.to === 'inspection',
  );

  return {
    possible: true,
    reason: check.reason,
    complaint: buildComplaint({
      request,
      address: building?.address || 'адрес не указан',
      residentName: resident.displayName,
      ...(home ? { residentApartment: home.number } : {}),
      ...(building?.managementCompany ? { managementCompany: building.managementCompany } : {}),
      ...(building?.timeZone ? { timeZone: building.timeZone } : {}),
      now,
      actorName: (actorId) => participants.get(actorId) ?? actorId,
    }),
    ...(sent ? { sent: { externalId: sent.externalId, dueAt: sent.dueAt, organization: sent.organization } } : {}),
  };
};

/** Обращение в жилинспекцию: текст собирается из истории заявки. @throws {DomainError} */
export const escalationFor = async (
  deps: AppDeps,
  resident: Resident,
  requestId: string,
): Promise<EscalationOffer> => offerFor(deps, resident, await requestOf(deps, requestId));

/** Передача обращения каналом надзора и запись факта передачи. */
const sendToInspection = async (deps: AppDeps, request: ServiceRequest, text: string): Promise<Handoff> => {
  const building = await deps.repository.findBuilding(request.buildingId);
  const partner = (building?.partners ?? []).find((item) => item.kind === 'inspection');
  const organization = partner?.title ?? HANDOFF_TITLES.inspection;
  const now = deps.now();
  const id = deps.createId();
  const gateway = deps.handoffs;

  const receipt = gateway
    ? await gateway
        .send({
          handoffId: id,
          to: 'inspection',
          organization,
          request,
          note: text,
          ...(building ? { building } : {}),
        } as Parameters<NonNullable<AppDeps['handoffs']>['send']>[0])
        .catch(() => undefined)
    : undefined;

  const failed = gateway !== undefined && receipt === undefined;

  return deps.repository.saveHandoff({
    id,
    requestId: request.id,
    buildingId: request.buildingId,
    to: 'inspection',
    organization,
    channel: gateway?.channel ?? partner?.channel ?? MANUAL_CHANNEL,
    status: receipt?.accepted === true ? 'accepted' : failed ? 'failed' : 'sent',
    byResident: true,
    dueAt: handoffDueAt('inspection', now),
    createdAt: now,
    ...(receipt?.externalId ? { externalId: receipt.externalId } : {}),
  });
};

/**
 * Отправка обращения в жилищную инспекцию за жильца. Продукт не только
 * составляет текст, но и передаёт его каналом надзора: сам жилец переписывать
 * и отправлять ничего не должен. Кнопка не отправляет молча, согласие
 * спрашивается отдельно, до вызова.
 */
export const sendComplaint = async (
  deps: AppDeps,
  resident: Resident,
  requestId: string,
): Promise<{ handoff: Handoff; complaint: string }> => {
  const request = await requestOf(deps, requestId);
  const offer = await offerFor(deps, resident, request);

  if (!offer.possible || !offer.complaint) {
    throw new DomainError('escalation_not_possible', `Оснований для обращения нет: ${offer.reason}`);
  }

  if (offer.sent) throw new DomainError('complaint_exists', 'Обращение по этой заявке уже отправлено');

  const handoff = await sendToInspection(deps, request, offer.complaint);

  // Смена видит обращение в той же заявке: надзор запросит у неё объяснение.
  await deps.repository.saveRequest(
    addMessage(request, {
      at: deps.now(),
      role: resident.role,
      actorId: resident.id,
      text:
        `Жилец обратился в надзор: ${handoff.organization}.` +
        `${handoff.externalId ? ` Номер обращения ${handoff.externalId}.` : ''}`,
    }),
  );

  const notifier = deps.notifier ?? noopNotifier;

  const t = speak(resident);

  await notifyResident(
    notifier,
    resident,
    t('app.notice.complaintSent', {
      организация: handoff.organization,
      номер: handoff.externalId ? t('app.notice.complaintNumber', { номер: handoff.externalId }) : '',
    }),
  );

  return { handoff, complaint: offer.complaint };
};
