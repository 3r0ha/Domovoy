import {
  OPEN_STATUSES,
  audienceForTarget,
  audienceKey,
  describeAudience,
  hasReported,
  houseMood,
  inspectionKindKey,
  isConfirmedIncident,
  isInAudience,
  type Apartment,
  type HouseMood,
  type ServiceRequest,
} from '@domovoy/domain';

import { speak } from './language.js';
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

/** Квартира жильца и дом, который из неё следует: одно чтение на оба ответа. */
const homeAndFlat = async (
  deps: AppDeps,
  resident: Resident,
): Promise<{ buildingId?: string; apartment?: Apartment }> => {
  const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;
  const buildingId = apartment?.buildingId ?? resident.buildingId;

  return { ...(buildingId ? { buildingId } : {}), ...(apartment ? { apartment } : {}) };
};

/** Что происходит в доме прямо сейчас. */
export const houseNow = async (deps: AppDeps, resident: Resident): Promise<HouseNow> => {
  const { buildingId, apartment } = await homeAndFlat(deps, resident);

  if (!buildingId) return { incidents: [], works: [], mood: 'sleeping' };

  const now = deps.now();

  const [open, announcements] = await Promise.all([
    deps.repository.listRequests({ buildingId, statuses: [...OPEN_STATUSES] }),
    deps.repository.listWorksBetween(buildingId, now, now),
  ]);

  const incidents = open.filter(
    (request) =>
      (request.priority === 'emergency' || isConfirmedIncident(request)) &&
      !hasReported(request, resident.id) &&
      touches(audienceForTarget(request.target), apartment),
  );

  const works = announcements.filter((announcement) =>
    touches(announcementAudience(announcement), apartment),
  );

  return { incidents, works, mood: houseMood(open, now) };
};

/** Что в доме будет на неделе: работы, собрания и обходы одной лентой. */
export const houseAhead = async (deps: AppDeps, resident: Resident, days = AHEAD_DAYS): Promise<HouseEvent[]> => {
  const { buildingId, apartment } = await homeAndFlat(deps, resident);

  if (!buildingId) return [];

  const now = deps.now();
  const until = new Date(now.getTime() + days * 24 * 3600_000);
  const events: HouseEvent[] = [];
  const t = speak(resident);

  const [announcements, polls, inspections] = await Promise.all([
    deps.repository.listWorksBetween(buildingId, now, until),
    deps.repository.listPolls(buildingId),
    deps.repository.listInspections(buildingId),
  ]);

  for (const announcement of announcements) {
    const audience = announcementAudience(announcement);

    if (!touches(audience, apartment) || !announcement.works) continue;
    if (announcement.works.from.getTime() <= now.getTime()) continue;

    events.push({
      kind: 'works',
      at: announcement.works.until,
      title: announcement.title,
      where: describeAudience(audience, t),
    });
  }

  for (const poll of polls) {
    if (poll.closedAt || poll.closesAt.getTime() > until.getTime() || poll.closesAt.getTime() < now.getTime()) continue;

    events.push({ kind: 'poll', at: poll.closesAt, title: poll.title, where: t(audienceKey('building')) });
  }

  for (const inspection of inspections) {
    if (inspection.finishedAt || inspection.dueAt.getTime() > until.getTime()) continue;

    events.push({
      kind: 'inspection',
      at: inspection.dueAt,
      title: t(inspectionKindKey(inspection.kind)),
      where:
        inspection.entrance === undefined
          ? t(audienceKey('building'))
          : t(audienceKey('entrance'), { подъезд: inspection.entrance }),
    });
  }

  return events.sort((left, right) => left.at.getTime() - right.at.getTime());
};
