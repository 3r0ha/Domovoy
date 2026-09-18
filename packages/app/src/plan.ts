import {
  DomainError,
  OPEN_STATUSES,
  isCompanyStaff,
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

/** Кто по заявке уже высказался: присоединился либо ответил «у меня работает». */
interface Voices {
  joined: Set<string>;
  fine: Set<string>;
}

/** Голоса по каждой заявке: иначе история заявки разбирается заново на каждую квартиру. */
const voicesOf = (requests: readonly ServiceRequest[]): Map<string, Voices> => {
  const voices = new Map<string, Voices>();

  for (const request of requests) {
    const joined = new Set(request.joinedBy.map((join) => join.residentId));
    const fine = new Set(
      request.notAffected
        .map((check) => check.residentId)
        .filter((residentId) => !hasReported(request, residentId)),
    );

    voices.set(request.id, { joined, fine });
  }

  return voices;
};

const stateOf = (
  apartment: Apartment,
  requests: readonly ServiceRequest[],
  living: readonly Resident[],
  voices: Map<string, Voices>,
): PlanFlat => {
  let alert: PlanFlat | undefined;
  let fine: PlanFlat | undefined;

  for (const request of requests) {
    const voice = voices.get(request.id);
    const works = living.some((person) => voice?.fine.has(person.id) === true);

    if (works) {
      fine ??= { number: apartment.number, state: 'fine', requestId: request.id };
      continue;
    }

    const joined = living.some((person) => voice?.joined.has(person.id) === true);

    if (!joined && !touches(apartment, request)) continue;

    alert ??= {
      number: apartment.number,
      state: request.priority === 'emergency' ? 'emergency' : 'open',
      requestId: request.id,
    };
  }

  return alert ?? fine ?? { number: apartment.number, state: 'quiet' };
};

/** Жильцы по квартирам: перебирать всех жильцов дома на каждую квартиру не нужно. */
const livingByApartment = (residents: readonly Resident[]): Map<string, Resident[]> => {
  const living = new Map<string, Resident[]>();

  for (const person of residents) {
    for (const apartmentId of apartmentsOf(person)) {
      const here = living.get(apartmentId) ?? [];

      here.push(person);
      living.set(apartmentId, here);
    }
  }

  return living;
};

/** Ключ стояка в разборе заявок: подъезд и стояк вместе. */
const riserKey = (entrance: number, riser: number): string => `${entrance}:${riser}`;

/** Заявки, разложенные по месту: отбор на каждый подъезд и стояк повторять нечем. */
interface PlanAlerts {
  risers: Map<string, PlanAlert[]>;
  entrances: Map<number, PlanAlert[]>;
  house: PlanAlert[];
}

const alertsByPlace = (ordered: readonly ServiceRequest[]): PlanAlerts => {
  const risers = new Map<string, PlanAlert[]>();
  const entrances = new Map<number, PlanAlert[]>();
  const house: PlanAlert[] = [];

  const push = <K>(where: Map<K, PlanAlert[]>, key: K, request: ServiceRequest): void => {
    const here = where.get(key) ?? [];

    here.push(alertOf(request));
    where.set(key, here);
  };

  for (const request of ordered) {
    const target = request.target;

    if (target.kind === 'riser') push(risers, riserKey(target.entrance, target.riser), request);
    if (target.kind === 'entrance') push(entrances, target.entrance, request);
    if (target.kind === 'building' || target.kind === 'equipment') house.push(alertOf(request));
  }

  return { risers, entrances, house };
};

/** План дома с обстановкой на нём. @throws {DomainError} */
export const housePlan = async (deps: AppDeps, resident: Resident): Promise<HousePlan> => {
  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'План дома ведёт управляющая компания');
  }

  const buildingId = resident.buildingId ?? deps.defaultBuildingId;

  const [apartments, requests, residents] = await Promise.all([
    deps.repository.listApartments(buildingId),
    deps.repository.listRequests({ buildingId, statuses: [...OPEN_STATUSES] }),
    deps.repository.listResidents(buildingId),
  ]);

  const ordered = [...requests].sort(
    (left, right) => Number(right.priority === 'emergency') - Number(left.priority === 'emergency'),
  );

  const living = livingByApartment(residents);
  const voices = voicesOf(ordered);
  const alerts = alertsByPlace(ordered);

  const entrances = new Map<number, Map<number, PlanFlat[]>>();

  for (const apartment of apartments) {
    const risers = entrances.get(apartment.entrance) ?? new Map<number, PlanFlat[]>();
    const flats = risers.get(apartment.riser) ?? [];

    flats.push(stateOf(apartment, ordered, living.get(apartment.id) ?? [], voices));
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
            alerts: alerts.risers.get(riserKey(entrance, riser)) ?? [],
          }))
          .sort((left, right) => left.riser - right.riser),
        alerts: alerts.entrances.get(entrance) ?? [],
      }))
      .sort((left, right) => left.entrance - right.entrance),
    house: alerts.house,
  };
};
