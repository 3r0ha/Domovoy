import {
  describeAudience,
  DomainError,
  isCompanyStaff,
  selectAudience,
  type AnnouncementAudience,
  type Apartment,
  type MeterKind,
  type RequestCategory,
  type Role,
} from '@domovoy/domain';

import { apartmentsOf } from '../apartments.js';
import { postToChat } from '../broadcast.js';
import { assertServes, homeOf, houseHintFor } from '../buildings.js';
import { wanting } from '../notices.js';
import { formatAnnouncement, noopNotifier, notifyAbout } from '../notifier.js';
import { isQuiet, nextMorning, wakesHouse } from '../quiet.js';
import { announcementAudience, type Announcement, type Resident } from '../repository.js';
import { zoneOf } from '../zone.js';
import { type AppDeps, type RequestPage } from './deps.js';

export interface AnnouncementCommand {
  resident: Resident;
  title: string;
  body: string;
  entrance?: number;
  riser?: number;
  /** Плановые работы: что не работает и до какого момента. */
  works?: { category: RequestCategory; from: Date; until: Date; resource?: MeterKind };
}

const CAN_PUBLISH: readonly Role[] = ['dispatcher', 'manager'];

export interface HouseNotice {
  buildingId: string;
  title: string;
  body: string;
  entrance?: number;
  riser?: number;
  works?: { category: RequestCategory; from: Date; until: Date; resource?: MeterKind };
  /** Заявка, из-за которой объявление и появилось: такое будит дом и ночью. */
  requestId?: string;
}

/** Объявление дому от продукта: так же, как от смены, но без проверки прав. */
export const announceToHouse = async (
  deps: AppDeps,
  notice: HouseNotice,
): Promise<{ announcement: Announcement; audience: AnnouncementAudience; notified: number }> => {
  const { buildingId, entrance, riser } = notice;

  const audience: AnnouncementAudience =
    riser !== undefined && entrance !== undefined
      ? { kind: 'riser', buildingId, entrance, riser }
      : entrance !== undefined
        ? { kind: 'entrance', buildingId, entrance }
        : { kind: 'building', buildingId };

  const apartments = await deps.repository.listApartments(buildingId);
  const recipients = selectAudience(apartments, audience);
  const now = deps.now();

  // Ночью дом не будят: объявление сохраняется и видно в приложении сразу,
  // а рассылка уходит утром. Аварию и начавшиеся работы это не задерживает.
  const zone = await zoneOf(deps, buildingId);
  const waits = isQuiet(now, zone) && !wakesHouse(notice, now);

  const announcement = await deps.repository.saveAnnouncement({
    id: deps.createId(),
    buildingId,
    audience: {
      kind: audience.kind,
      ...(entrance !== undefined ? { entrance } : {}),
      ...(riser !== undefined ? { riser } : {}),
    },
    title: notice.title,
    body: notice.body,
    createdAt: now,
    recipientIds: recipients.map((apartment) => apartment.id),
    ...(notice.works ? { works: notice.works } : {}),
    ...(notice.requestId ? { requestId: notice.requestId } : {}),
    ...(waits ? { deliverAt: nextMorning(now, zone) } : {}),
  });

  if (waits) return { announcement, audience, notified: 0 };

  const notified = await deliverAnnouncement(deps, announcement, audience, apartments);

  return { announcement, audience, notified };
};

/**
 * Рассылка объявления: уведомления жильцам и сообщение в чат дома. Вызывается
 * сразу при публикации, а у ночных объявлений, утром обходом.
 */
export const deliverAnnouncement = async (
  deps: AppDeps,
  announcement: Announcement,
  audience: AnnouncementAudience,
  known?: readonly Apartment[],
): Promise<number> => {
  const notifier = deps.notifier ?? noopNotifier;
  const apartments = known ?? (await deps.repository.listApartments(announcement.buildingId));
  const residents = await deps.repository.listResidentsByApartments(announcement.recipientIds);
  const text = formatAnnouncement(announcement.title, announcement.body);

  const wants = wanting(residents, announcement.works ? 'works' : 'news');
  const hintOf = houseHintFor(deps, announcement.buildingId, apartments);

  for (const resident of wants) {
    const house = await hintOf(resident);

    await notifyAbout(
      notifier,
      resident,
      house ? formatAnnouncement(announcement.title, announcement.body, house) : text,
      {
        section: 'news',
        mutable: announcement.works ? 'works' : 'news',
      },
    );
  }

  await postToChat(deps, announcement, audience);

  return wants.length;
};

/** Ночные объявления, которым пора уйти. Возвращает, скольким людям ушло. */
export const deliverPendingAnnouncements = async (deps: AppDeps, buildingId: string): Promise<number> => {
  const now = deps.now();
  const waiting = (await deps.repository.listAnnouncements(buildingId)).filter(
    (item) => item.deliverAt !== undefined && item.deliverAt.getTime() <= now.getTime(),
  );

  let notified = 0;

  for (const announcement of waiting) {
    const sent = await deps.repository.saveAnnouncement({ ...announcement, deliverAt: undefined });

    notified += await deliverAnnouncement(deps, sent, announcementAudience(sent));
  }

  return notified;
};

/** Публикация объявления. */
export const publishAnnouncement = async (
  deps: AppDeps,
  command: AnnouncementCommand,
): Promise<{
  announcement: Announcement;
  audience: AnnouncementAudience;
  description: string;
  /** Скольким жильцам ушло уведомление: охват по квартирам может быть шире. */
  notified: number;
}> => {
  if (!CAN_PUBLISH.includes(command.resident.role)) {
    throw new DomainError('forbidden', 'Объявления публикует управляющая организация');
  }

  const buildingId = command.resident.buildingId ?? deps.defaultBuildingId;

  await assertServes(deps, command.resident, buildingId);

  const { announcement, audience, notified } = await announceToHouse(deps, {
    buildingId,
    title: command.title,
    body: command.body,
    ...(command.entrance !== undefined ? { entrance: command.entrance } : {}),
    ...(command.riser !== undefined ? { riser: command.riser } : {}),
    ...(command.works ? { works: command.works } : {}),
  });

  return { announcement, audience, description: describeAudience(audience), notified };
};

/** Сколько объявлений отдаём за раз. */
export const NEWS_PAGE = 20;

/** Объявления, которые касаются жильца. */
export const listAnnouncementsFor = async (
  deps: AppDeps,
  resident: Resident,
  page: RequestPage = {},
): Promise<Announcement[]> => {
  const buildingId = resident.buildingId;
  const home = await homeOf(deps, resident);
  // Подрядчик не сотрудник компании: объявления дома целиком ему не предназначены.
  const isStaff = isCompanyStaff(resident.role);
  const own = apartmentsOf(resident);

  const addressed = (announcement: Announcement): boolean =>
    announcement.audience.kind === 'building' ||
    own.some((apartmentId) => announcement.recipientIds.includes(apartmentId));

  const mine = isStaff && buildingId ? await deps.repository.listAnnouncements(buildingId) : [];

  if (home !== undefined && (!isStaff || home !== buildingId)) {
    for (const announcement of await deps.repository.listAnnouncements(home)) {
      if (addressed(announcement)) mine.push(announcement);
    }
  }

  return [...new Map(mine.map((announcement) => [announcement.id, announcement])).values()]
    .filter((announcement) => (page.before ? announcement.createdAt.getTime() < page.before.getTime() : true))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, page.limit ?? NEWS_PAGE);
};
