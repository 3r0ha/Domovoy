import {
  INSPECTION_RULES,
  OPEN_STATUSES,
  audienceForTarget,
  describeAudience,
  hasReported,
  houseMood,
  isConfirmedIncident,
  isInAudience,
  type Apartment,
  type HouseMood,
  type ServiceRequest,
} from '@domovoy/domain';

import { homeOf } from './buildings.js';
import { announcementAudience, type Announcement, type Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

export interface HouseNow {
  /** Аварии, которые касаются этого человека. */
  incidents: ServiceRequest[];
  /** Работы, идущие прямо сейчас. */
  works: Announcement[];
  /** Состояние дома целиком. */
  mood: HouseMood;
}

/** Что в доме будет: одно событие ленты. */
export interface HouseEvent {
  kind: 'works' | 'poll' | 'inspection';
  /** Когда это случится или закончится. */
  at: Date;
  title: string;
  /** Кого это касается: «весь дом», «подъезд 1». */
  where: string;
}

/** На сколько вперёд смотрит лента. */
export const AHEAD_DAYS = 7;

/** Касается ли адресат этой квартиры. Без квартиры только общедомовое. */
const touches = (
  audience: ReturnType<typeof audienceForTarget>,
  apartment: Apartment | undefined,
): boolean => {
  if (!audience) return false;
  if (audience.kind === 'building') return true;

  return apartment ? isInAudience(apartment, audience) : false;
};

/** Что происходит в доме прямо сейчас. */
export const houseNow = async (deps: AppDeps, resident: Resident): Promise<HouseNow> => {
  const buildingId = await homeOf(deps, resident);

  if (!buildingId) return { incidents: [], works: [], mood: 'sleeping' };

  const now = deps.now();
  const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;

  const open = await deps.repository.listRequests({ buildingId, statuses: [...OPEN_STATUSES] });

  const incidents = open.filter(
    (request) =>
      (request.priority === 'emergency' || isConfirmedIncident(request)) &&
      !hasReported(request, resident.id) &&
      touches(audienceForTarget(request.target), apartment),
  );

  const works = (await deps.repository.listWorksBetween(buildingId, now, now)).filter((announcement) =>
    touches(announcementAudience(announcement), apartment),
  );

  return { incidents, works, mood: houseMood(open, now) };
};

/** Что в доме будет на неделе: работы, собрания и обходы одной лентой. */
export const houseAhead = async (deps: AppDeps, resident: Resident, days = AHEAD_DAYS): Promise<HouseEvent[]> => {
  const buildingId = await homeOf(deps, resident);

  if (!buildingId) return [];

  const now = deps.now();
  const until = new Date(now.getTime() + days * 24 * 3600_000);
  const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;
  const events: HouseEvent[] = [];

  for (const announcement of await deps.repository.listWorksBetween(buildingId, now, until)) {
    const audience = announcementAudience(announcement);

    if (!touches(audience, apartment) || !announcement.works) continue;
    if (announcement.works.from.getTime() <= now.getTime()) continue;

    events.push({
      kind: 'works',
      at: announcement.works.until,
      title: announcement.title,
      where: describeAudience(audience),
    });
  }

  for (const poll of await deps.repository.listPolls(buildingId)) {
    if (poll.closedAt || poll.closesAt.getTime() > until.getTime() || poll.closesAt.getTime() < now.getTime()) continue;

    events.push({ kind: 'poll', at: poll.closesAt, title: poll.title, where: 'весь дом' });
  }

  for (const inspection of await deps.repository.listInspections(buildingId)) {
    if (inspection.finishedAt || inspection.dueAt.getTime() > until.getTime()) continue;

    events.push({
      kind: 'inspection',
      at: inspection.dueAt,
      title: INSPECTION_RULES[inspection.kind].title,
      where: inspection.entrance === undefined ? 'весь дом' : `подъезд ${inspection.entrance}`,
    });
  }

  return events.sort((left, right) => left.at.getTime() - right.at.getTime());
};
