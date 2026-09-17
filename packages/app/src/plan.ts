import {
  DomainError,
  OPEN_STATUSES,
  isCompanyStaff,
  hasAnswered,
  hasReported,
  type Apartment,
  type ServiceRequest,
} from '@domovoy/domain';

import { apartmentsOf } from './apartments.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Что с квартирой прямо сейчас. */
export type FlatState = 'emergency' | 'open' | 'fine' | 'quiet';

export interface PlanFlat {
  number: number;
  state: FlatState;
  /** Заявка, из-за которой квартира подсвечена. */
  requestId?: string;
}

export interface PlanAlert {
  id: string;
  title: string;
  emergency: boolean;
}

export interface PlanRiser {
  riser: number;
  flats: PlanFlat[];
  /** Заявки на весь стояк. */
  alerts: PlanAlert[];
}

export interface PlanEntrance {
  entrance: number;
  risers: PlanRiser[];
  /** Заявки на весь подъезд. */
  alerts: PlanAlert[];
}

export interface HousePlan {
  entrances: PlanEntrance[];
  /** Дом целиком и оборудование: на сетке квартир им места нет. */
  house: PlanAlert[];
}

/** Заявка по самой квартире, без заявок по её подъезду. */
const touches = (apartment: Apartment, request: ServiceRequest): boolean => {
  const target = request.target;

  if (target.kind === 'apartment') return target.apartmentId === apartment.id;

  if (target.kind === 'riser') {
    return target.buildingId === apartment.buildingId && target.entrance === apartment.entrance && target.riser === apartment.riser;
  }

  return false;
};

const alertOf = (request: ServiceRequest): PlanAlert => ({
  id: request.id,
  title: request.title,
  emergency: request.priority === 'emergency',
});

const stateOf = (
  apartment: Apartment,
  requests: readonly ServiceRequest[],
  residents: readonly Resident[],
): PlanFlat => {
  const living = residents.filter((person) => apartmentsOf(person).includes(apartment.id));

  let alert: PlanFlat | undefined;
  let fine: PlanFlat | undefined;

  for (const request of requests) {
    const joined = living.some((person) => request.joinedBy.some((join) => join.residentId === person.id));
    const works = living.some((person) => hasAnswered(request, person.id) && !hasReported(request, person.id));

    if (works) {
      fine ??= { number: apartment.number, state: 'fine', requestId: request.id };
      continue;
    }

    if (!joined && !touches(apartment, request)) continue;

    alert ??= {
      number: apartment.number,
      state: request.priority === 'emergency' ? 'emergency' : 'open',
      requestId: request.id,
    };
  }

  return alert ?? fine ?? { number: apartment.number, state: 'quiet' };
};

/** План дома с обстановкой на нём. @throws {DomainError} */
export const housePlan = async (deps: AppDeps, resident: Resident): Promise<HousePlan> => {
  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'План дома ведёт управляющая компания');
  }

  const buildingId = resident.buildingId ?? deps.defaultBuildingId;
  const apartments = await deps.repository.listApartments(buildingId);
  const requests = await deps.repository.listRequests({ buildingId, statuses: [...OPEN_STATUSES] });
  const residents = await deps.repository.listResidents(buildingId);

  const ordered = [...requests].sort(
    (left, right) => Number(right.priority === 'emergency') - Number(left.priority === 'emergency'),
  );

  const entrances = new Map<number, Map<number, PlanFlat[]>>();

  for (const apartment of apartments) {
    const risers = entrances.get(apartment.entrance) ?? new Map<number, PlanFlat[]>();
    const flats = risers.get(apartment.riser) ?? [];

    flats.push(stateOf(apartment, ordered, residents));
    risers.set(apartment.riser, flats);
    entrances.set(apartment.entrance, risers);
  }

  return {
    entrances: [...entrances.entries()]
      .map(([entrance, risers]) => ({
        entrance,
        risers: [...risers.entries()]
          .map(([riser, flats]) => ({
            riser,
            flats: flats.sort((left, right) => left.number - right.number),
            alerts: ordered
              .filter(
                (request) =>
                  request.target.kind === 'riser' &&
                  request.target.entrance === entrance &&
                  request.target.riser === riser,
              )
              .map(alertOf),
          }))
          .sort((left, right) => left.riser - right.riser),
        alerts: ordered
          .filter((request) => request.target.kind === 'entrance' && request.target.entrance === entrance)
          .map(alertOf),
      }))
      .sort((left, right) => left.entrance - right.entrance),
    house: ordered
      .filter((request) => request.target.kind === 'building' || request.target.kind === 'equipment')
      .map(alertOf),
  };
};
