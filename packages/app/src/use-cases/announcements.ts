import {
  describeAudience,
  DomainError,
  selectAudience,
  type AnnouncementAudience,
  type RequestCategory,
  type Role,
} from '@domovoy/domain';

import { apartmentsOf } from '../apartments.js';
import { postToChat } from '../broadcast.js';
import { homeBuildingOf, houseHint } from '../buildings.js';
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
  works?: { category: RequestCategory; from: Date; until: Date };
}

const CAN_PUBLISH: readonly Role[] = ['dispatcher', 'manager'];

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
  const { entrance, riser } = command;

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
    title: command.title,
    body: command.body,
    createdAt: deps.now(),
    recipientIds: recipients.map((apartment) => apartment.id),
    ...(command.works ? { works: command.works } : {}),
  });

  const notifier = deps.notifier ?? noopNotifier;
  const residents = await deps.repository.listResidentsByApartments(announcement.recipientIds);
  const text = formatAnnouncement(command.title, command.body);

  const wants = wanting(residents, command.works ? 'works' : 'news');

  for (const resident of wants) {
    const house = await houseHint(deps, resident, announcement.buildingId);

    await notifyAbout(notifier, resident, house ? formatAnnouncement(command.title, command.body, house) : text, {
      section: 'news',
      mutable: command.works ? 'works' : 'news',
    });
  }

  await postToChat(deps, announcement, audience);

  return { announcement, audience, description: describeAudience(audience), notified: wants.length };
};

/** Сколько объявлений отдаём за раз. */
export const NEWS_PAGE = 20;

/** Объявления, которые касаются жильца. */
export const listAnnouncementsFor = async (
  deps: AppDeps,
  resident: Resident,
  page: RequestPage = {},
): Promise<Announcement[]> => {
  const buildingId = resident.buildingId ?? deps.defaultBuildingId;
  const home = await homeBuildingOf(deps, resident);
  const isStaff = resident.role !== 'resident';
  const own = apartmentsOf(resident);

  const addressed = (announcement: Announcement): boolean =>
    announcement.audience.kind === 'building' ||
    own.some((apartmentId) => announcement.recipientIds.includes(apartmentId));

  const mine = isStaff ? await deps.repository.listAnnouncements(buildingId) : [];

  if (!isStaff || home !== buildingId) {
    for (const announcement of await deps.repository.listAnnouncements(home)) {
      if (addressed(announcement)) mine.push(announcement);
    }
  }

  return [...new Map(mine.map((announcement) => [announcement.id, announcement])).values()]
    .filter((announcement) => (page.before ? announcement.createdAt.getTime() < page.before.getTime() : true))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, page.limit ?? NEWS_PAGE);
};
