import { DomainError, ELDER_TERM_YEARS, elderNow, type Eldership, type Poll } from '@domovoy/domain';

import { apartmentIn, apartmentsOf } from './apartments.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { startPoll } from './voting.js';

/** Старший подъезда, если он сейчас есть. */
export const elderOf = async (
  deps: AppDeps,
  buildingId: string,
  entrance: number,
): Promise<Eldership | undefined> =>
  elderNow(await deps.repository.listElderships(buildingId), entrance, deps.now());

/** Старший ли этот житель у своего подъезда. */
export const isElder = async (deps: AppDeps, resident: Resident): Promise<boolean> => {
  for (const apartmentId of apartmentsOf(resident)) {
    const flat = await deps.repository.findApartment(apartmentId);

    if (!flat) continue;

    if ((await elderOf(deps, flat.buildingId, flat.entrance))?.residentId === resident.id) return true;
  }

  return false;
};

/** Старший подъезда, к которому относится заявка. */
export const elderForEntrance = async (
  deps: AppDeps,
  buildingId: string,
  entrance: number | undefined,
): Promise<Resident | undefined> => {
  if (entrance === undefined) return undefined;

  const eldership = await elderOf(deps, buildingId, entrance);

  return eldership ? deps.repository.findResident(eldership.residentId) : undefined;
};

export interface ElderPollCommand {
  resident: Resident;
  /** Кого предлагают старшим. Подъезд берётся из его квартиры. */
  candidateId: string;
  days: number;
}

/** Собрание о старшем по подъезду: его избирают собственники (ЖК РФ, ст. 161.1). @throws {DomainError} */
export const startElderPoll = async (deps: AppDeps, command: ElderPollCommand): Promise<Poll> => {
  const buildingId = command.resident.buildingId ?? deps.defaultBuildingId;
  const candidate = await deps.repository.findResident(command.candidateId);

  if (!candidate || apartmentsOf(candidate).length === 0) {
    throw new DomainError('candidate_unknown', 'Старшим выбирают собственника помещения в этом подъезде');
  }

  const flat = await apartmentIn(deps, candidate, buildingId);

  if (!flat) {
    throw new DomainError('candidate_elsewhere', 'Кандидат живёт в другом доме');
  }

  const entrance = flat.entrance;

  const poll = await startPoll(deps, {
    resident: command.resident,
    kind: 'simple',
    title: `Старший по подъезду ${entrance}`,
    question:
      `Избрать старшим по подъезду ${entrance} собственника: ${candidate.displayName}. ` +
      `Срок полномочий: ${ELDER_TERM_YEARS} года.`,
    days: command.days,
  });

  return deps.repository.savePoll({ ...poll, elder: { entrance, residentId: candidate.id } });
};
