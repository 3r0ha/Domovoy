import {
  describeAudience,
  DomainError,
  isCompanyStaff,
  selectAudience,
  type AnnouncementAudience,
  type MeterKind,
  type RequestCategory,
  type Role,
} from '@domovoy/domain';

import { apartmentsOf } from '../apartments.js';
import { postToChat } from '../broadcast.js';
import { assertServes, homeOf, houseHintFor } from '../buildings.js';
import { wanting } from '../notices.js';
import { formatAnnouncement, noopNotifier, notifyAbout } from '../notifier.js';
import { type Announcement, type Resident } from '../repository.js';
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
    createdAt: deps.now(),
    recipientIds: recipients.map((apartment) => apartment.id),
    ...(notice.works ? { works: notice.works } : {}),
  });

  const notifier = deps.notifier ?? noopNotifier;
  const residents = await deps.repository.listResidentsByApartments(announcement.recipientIds);
  const text = formatAnnouncement(notice.title, notice.body);

  const wants = wanting(residents, notice.works ? 'works' : 'news');
  const hintOf = houseHintFor(deps, announcement.buildingId, apartments);

  for (const resident of wants) {
    const house = await hintOf(resident);

    await notifyAbout(notifier, resident, house ? formatAnnouncement(notice.title, notice.body, house) : text, {
      section: 'news',
      mutable: notice.works ? 'works' : 'news',
    });
  }

  await postToChat(deps, announcement, audience);

  return { announcement, audience, notified: wants.length };
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
    throw new DomainError('forbidden', 'Объявления публикует управляющая компания');
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
