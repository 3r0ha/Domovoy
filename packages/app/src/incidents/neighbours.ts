import {
  audienceForTarget,
  DomainError,
  flatAbove,
  hasAnswered,
  isCompanyStaff,
  isFinal,
  isInAudience,
  isSharedInfrastructure,
  joinRequest,
  markUnaffected,
  promoteToShared,
  reporterIds,
  reportersCount,
  selectAudience,
  type Apartment,
  type ServiceRequest,
} from '@domovoy/domain';

import { apartmentsOf, locateTarget } from '../apartments.js';
import { assertServes } from '../buildings.js';
import { formatKnock, noopNotifier, notifyResident } from '../notifier.js';
import { type Resident } from '../repository.js';
import { type AppDeps } from '../use-cases.js';
import { confirmIncident } from './notify.js';

/** Квартира над той, о которой заявка. */
const upstairsOf = async (deps: AppDeps, request: ServiceRequest): Promise<Apartment | undefined> => {
  if (request.target.kind !== 'apartment') return undefined;

  const flat = await deps.repository.findApartment(request.target.apartmentId);

  if (!flat) return undefined;

  return flatAbove(await deps.repository.listApartments(request.buildingId), flat);
};

export interface AlertAnswer {
  resident: Resident;
  requestId: string;
  /** «У меня то же самое» или «у меня всё работает». */
  affected: boolean;
}

export interface AlertAnswerResult {
  request: ServiceRequest;
  /** Ответ засчитан. */
  counted: boolean;
}

/** Есть ли кому постучать: соседа без приложения стук не разбудит. */
export const canKnockUpstairs = async (deps: AppDeps, request: ServiceRequest): Promise<boolean> => {
  if (request.knockedAt || isFinal(request.status)) return false;

  const above = await upstairsOf(deps, request);

  if (!above) return false;

  return (await deps.repository.listResidentsByApartments([above.id])).length > 0;
};

export interface KnockCommand {
  resident: Resident;
  requestId: string;
}

/**
 * Домовой стучится к соседу сверху: вопрос уходит адресно, без имён
 * и номеров квартир.
 * @throws {DomainError}
 */
export const knockUpstairs = async (deps: AppDeps, command: KnockCommand): Promise<ServiceRequest> => {
  const found = await deps.repository.findRequest(command.requestId);

  if (!found) throw new DomainError('request_not_found', 'Заявка не найдена');

  if (found.authorId !== command.resident.id && !isCompanyStaff(command.resident.role)) {
    throw new DomainError('forbidden', 'Постучать к соседу сверху может тот, кто подал заявку');
  }

  if (found.authorId !== command.resident.id) await assertServes(deps, command.resident, found.buildingId);

  if (isFinal(found.status)) throw new DomainError('request_closed', `Заявка ${found.number} уже закрыта`);
  if (found.knockedAt) throw new DomainError('already_knocked', 'Соседу сверху уже постучали');

  const above = await upstairsOf(deps, found);

  if (!above) throw new DomainError('no_upstairs', 'Над этой квартирой соседей нет');

  const neighbours = await deps.repository.listResidentsByApartments([above.id]);

  if (neighbours.length === 0) {
    throw new DomainError('upstairs_unknown', 'Сосед сверху ещё не в приложении, позвать его отсюда нельзя');
  }

  const saved = await deps.repository.saveRequest({ ...found, knockedAt: deps.now() });
  const notifier = deps.notifier ?? noopNotifier;

  for (const neighbour of neighbours) {
    await notifyResident(notifier, neighbour, formatKnock(saved), [], undefined, saved.id);
  }

  return saved;
};

/** Спрашивали ли этого человека: тот же круг, по которому ушёл вопрос. */
const wasAsked = async (deps: AppDeps, request: ServiceRequest, resident: Resident): Promise<boolean> => {
  const own = apartmentsOf(resident);

  if (own.length === 0) return false;

  if (request.knockedAt) {
    const upstairs = (await upstairsOf(deps, request))?.id;

    if (upstairs !== undefined && own.includes(upstairs)) return true;
  }

  const audience = isSharedInfrastructure(request.category)
    ? await locateTarget(deps, request.target)
    : audienceForTarget(request.target);

  if (!audience) return false;

  for (const apartmentId of own) {
    const apartment = await deps.repository.findApartment(apartmentId);

    if (apartment && isInAudience(apartment, audience)) return true;
  }

  return false;
};

/** Ответ соседа на предупреждение об аварии. @throws {DomainError} если заявки нет или она уже закрыта. */
export const answerAlert = async (deps: AppDeps, command: AlertAnswer): Promise<AlertAnswerResult> => {
  const found = await deps.repository.findRequest(command.requestId);
  if (!found) throw new DomainError('request_not_found', 'Заявка не найдена');

  if (isFinal(found.status)) {
    throw new DomainError('request_closed', `Заявка ${found.number} уже закрыта`);
  }

  if (hasAnswered(found, command.resident.id)) return { request: found, counted: false };

  if (!(await wasAsked(deps, found, command.resident))) {
    throw new DomainError('forbidden', 'Об этой аварии вас не спрашивали');
  }

  if (command.affected) {
    const audience = await locateTarget(deps, found.target);
    const promoted = audience ? promoteToShared(found, audience) : found;
    const saved = await deps.repository.saveRequest(joinRequest(promoted, command.resident.id, deps.now()));
    const reporters = reportersCount(saved);

    await confirmIncident(deps, saved, reporters);

    return { request: saved, counted: true };
  }

  const saved = await deps.repository.saveRequest(markUnaffected(found, command.resident.id, deps.now()));

  return { request: saved, counted: true };
};

export interface SurveyedApartment {
  number: number;
  /** «Тоже нет», «работает» или «не отвечали». */
  state: 'affected' | 'fine' | 'silent';
}

/** Опрос по квартирам затронутого адреса. */
export const surveyOf = async (deps: AppDeps, request: ServiceRequest): Promise<SurveyedApartment[]> => {
  const audience = isSharedInfrastructure(request.category)
    ? await locateTarget(deps, request.target)
    : audienceForTarget(request.target);

  if (!audience) return [];

  const apartments = selectAudience(await deps.repository.listApartments(audience.buildingId), audience);

  if (apartments.length === 0) return [];

  const residents = await deps.repository.listResidentsByApartments(apartments.map((apartment) => apartment.id));
  const affected = new Set(reporterIds(request));
  const fine = new Set(request.notAffected.map((check) => check.residentId));

  const stateOf = (apartmentId: string): SurveyedApartment['state'] => {
    const living = residents.filter((resident) => apartmentsOf(resident).includes(apartmentId));

    if (living.some((resident) => affected.has(resident.id))) return 'affected';
    if (living.some((resident) => fine.has(resident.id))) return 'fine';

    return 'silent';
  };

  return apartments
    .map((apartment) => ({ number: apartment.number, state: stateOf(apartment.id) }))
    .sort((left, right) => left.number - right.number);
};
