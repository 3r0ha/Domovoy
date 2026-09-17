import {
  CONFIRMED_INCIDENT_REPORTERS,
  onCall,
  OPEN_STATUSES,
  WORKING_HOURS,
  type ServiceRequest,
} from '@domovoy/domain';

import { announceIncident } from '../broadcast.js';
import { actionsFor, formatNewRequest, noopNotifier, notifyResident } from '../notifier.js';
import { type AppDeps } from '../use-cases.js';
import { zoneOf } from '../zone.js';

/** Уведомление сотрудникам: срок реакции по аварии пятнадцать минут. */
export const notifyStaff = async (deps: AppDeps, request: ServiceRequest, reporters: number): Promise<void> => {
  const notifier = deps.notifier ?? noopNotifier;
  const own = await deps.repository.listStaff(request.buildingId);

  const orphan = own.length === 0;
  const responsible = orphan ? await deps.repository.listManagers() : own;

  const staff = onCall(responsible, deps.now(), WORKING_HOURS, await zoneOf(deps, request.buildingId));
  const building = orphan ? await deps.repository.findBuilding(request.buildingId) : undefined;
  const text =
    formatNewRequest(request, reporters) +
    (orphan ? `\n\nЗа домом ${building?.code ?? request.buildingId} никто не закреплён, назначьте сотрудника.` : '');

  for (const person of staff) {
    if (person.id === request.authorId) continue;

    await notifyResident(notifier, person, text, actionsFor(request, person), request.id);
  }
};

/** Подтверждённая соседями авария: смену зовут повторно, дом узнаёт об этом сам. */
export const confirmIncident = async (
  deps: AppDeps,
  request: ServiceRequest,
  reporters: number,
): Promise<void> => {
  if (reporters !== CONFIRMED_INCIDENT_REPORTERS) return;

  await notifyStaff(deps, request, reporters);
  await announceIncident(deps, request);
};

/** Кому в управляющей компании адресовано сообщение о заявке. */
export const notifyResponsible = async (deps: AppDeps, request: ServiceRequest, text: string): Promise<void> => {
  const notifier = deps.notifier ?? noopNotifier;
  const replyTo = OPEN_STATUSES.includes(request.status) ? request.id : undefined;

  if (request.assigneeId) {
    const assignee = await deps.repository.findResident(request.assigneeId);

    if (assignee) {
      await notifyResident(notifier, assignee, text, actionsFor(request, assignee), replyTo);
      return;
    }
  }

  const staff = onCall(
    await deps.repository.listStaff(request.buildingId),
    deps.now(),
    WORKING_HOURS,
    await zoneOf(deps, request.buildingId),
  );

  const responsible = staff.length > 0 ? staff : await deps.repository.listManagers();

  for (const person of responsible) {
    await notifyResident(notifier, person, text, actionsFor(request, person), replyTo);
  }
};
