import {
  apartmentCodeFrom,
  audienceForTarget,
  DomainError,
  isCompanyStaff,
  type AnnouncementAudience,
  type Apartment,
  type RequestTarget,
} from '@domovoy/domain';

import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Сколько раз пробовать, если код уже занят другой квартирой. */
const CODE_TRIES = 5;

/** Новый код квартиры: занятый другой квартирой не выдаётся. */
export const issueApartmentCode = async (deps: AppDeps): Promise<string> => {
  for (let attempt = 0; attempt < CODE_TRIES; attempt += 1) {
    const code = apartmentCodeFrom(deps.createCode ? deps.createCode() : `${deps.createId()}${attempt}`);
    const taken = await deps.repository.findApartmentByCode(code);

    if (!taken) return code;
  }

  throw new DomainError('code_not_issued', 'Не удалось выдать код квартиры, попробуйте ещё раз');
};

/** Все квартиры человека: текущая плюс остальные привязанные. */
export const apartmentsOf = (resident: Pick<Resident, 'apartmentId' | 'apartmentIds'>): string[] => [
  ...new Set([...(resident.apartmentId ? [resident.apartmentId] : []), ...(resident.apartmentIds ?? [])]),
];

/** Квартира человека в этом доме, если она там есть. */
export const apartmentIn = async (
  deps: AppDeps,
  resident: Resident,
  buildingId: string,
): Promise<Apartment | undefined> => {
  for (const apartmentId of apartmentsOf(resident)) {
    const apartment = await deps.repository.findApartment(apartmentId);

    if (apartment?.buildingId === buildingId) return apartment;
  }

  return undefined;
};

/**
 * Где находится объект: квартира превращается в свой стояк, течь общая.
 * Уже прочитанные квартиры дома передаются в `known`, тогда чтения не будет.
 */
export const locateTarget = async (
  deps: AppDeps,
  target: RequestTarget,
  known?: ReadonlyMap<string, Apartment>,
): Promise<AnnouncementAudience | null> => {
  if (target.kind !== 'apartment') return audienceForTarget(target);

  const apartment = known?.get(target.apartmentId) ?? (await deps.repository.findApartment(target.apartmentId));

  if (!apartment) return null;

  return {
    kind: 'riser',
    buildingId: apartment.buildingId,
    entrance: apartment.entrance,
    riser: apartment.riser,
  };
};

/**
 * Квартира становится текущей. У жильца вместе с ней переключается дом,
 * у сотрудника нет: смену он ведёт там, где работает, а не там, где живёт.
 */
export const withApartment = (resident: Resident, apartment: Apartment): Resident => ({
  ...resident,
  apartmentId: apartment.id,
  apartmentIds: [...new Set([...apartmentsOf(resident), apartment.id])],
  ...(isCompanyStaff(resident.role) ? {} : { buildingId: apartment.buildingId }),
});

/** Квартира отвязывается: текущей становится следующая из оставшихся. */
export const withoutApartment = (resident: Resident, apartmentId: string): Resident => {
  const rest = apartmentsOf(resident).filter((id) => id !== apartmentId);
  const detached: Resident = { ...resident, apartmentIds: rest };

  if (resident.apartmentId === apartmentId) {
    delete detached.apartmentId;

    if (rest[0]) detached.apartmentId = rest[0];
  }

  return detached;
};

export interface OwnApartment {
  id: string;
  number: number;
  buildingId: string;
  address: string;
  /** Квартира, с которой человек работает сейчас. */
  current: boolean;
}

/** Квартиры человека с адресами: по ним он и переключается. */
export const listOwnApartments = async (deps: AppDeps, resident: Resident): Promise<OwnApartment[]> => {
  const ids = apartmentsOf(resident);
  const found: OwnApartment[] = [];

  for (const id of ids) {
    const apartment = await deps.repository.findApartment(id);

    if (!apartment) continue;

    const building = await deps.repository.findBuilding(apartment.buildingId);

    found.push({
      id: apartment.id,
      number: apartment.number,
      buildingId: apartment.buildingId,
      address: building?.address || building?.code || '',
      current: apartment.id === resident.apartmentId,
    });
  }

  return found.sort((left, right) => left.address.localeCompare(right.address, 'ru') || left.number - right.number);
};

/** Переключиться на другую свою квартиру. @throws {DomainError} */
export const useApartment = async (deps: AppDeps, resident: Resident, apartmentId: string): Promise<Resident> => {
  if (resident.apartmentId === apartmentId) return resident;

  if (!apartmentsOf(resident).includes(apartmentId)) {
    throw new DomainError('forbidden', 'Эта квартира не привязана к вам');
  }

  const apartment = await deps.repository.findApartment(apartmentId);

  if (!apartment) throw new DomainError('apartment_unknown', 'Квартира не найдена');

  return deps.repository.saveResident(withApartment(resident, apartment));
};
