import { CATEGORY_RULES, audienceForTarget, selectAudience } from '@domovoy/domain';
import type { AnnouncementAudience, ServiceRequest } from '@domovoy/domain';

import { noopNotifier, notifyResident } from './notifier.js';
import { announcementAudience, type Announcement } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { formatMomentAt, houseZone } from './zone.js';

/** Что сделать с объявлением в чате помимо отправки. */
interface ChatPost {
  /** Закрепить: авария висит наверху чата, пока её не устранят. */
  pin?: boolean;
  /** Снять закреплённое: то, о чём объявляли, уже закончилось. */
  unpin?: boolean;
}

/** Сообщение в чат дома, если он привязан. */
export const postTextToChat = async (
  deps: AppDeps,
  buildingId: string,
  text: string,
  post: ChatPost = {},
): Promise<void> => {
  const notifier = deps.notifier ?? noopNotifier;
  const building = await deps.repository.findBuilding(buildingId);
  const chatId = building?.chatId;

  if (chatId === undefined || !notifier.sendToChat) return;

  try {
    if (post.unpin && notifier.unpinInChat) await notifier.unpinInChat(chatId);

    const messageId = await notifier.sendToChat(chatId, text);

    if (messageId === undefined) {
      await tellStaffChatIsLost(deps, buildingId);
      return;
    }

    if (post.pin && notifier.pinInChat) await notifier.pinInChat(chatId, messageId);
  } catch (error) {
    notifier.onError?.(error);
    await tellStaffChatIsLost(deps, buildingId);
  }
};

/**
 * В чат дома не удалось написать: бота из него удалили или чат сменился.
 * Объявление молча не теряется, смена узнаёт и привязывает чат заново.
 */
const tellStaffChatIsLost = async (deps: AppDeps, buildingId: string): Promise<void> => {
  const notifier = deps.notifier ?? noopNotifier;
  const staff = await deps.repository.listStaff(buildingId).catch(() => []);
  const building = await deps.repository.findBuilding(buildingId);

  for (const person of staff) {
    if (person.role !== 'manager' && person.role !== 'dispatcher') continue;

    await notifyResident(
      notifier,
      person,
      `Не получилось написать в чат дома ${building?.address ?? ''}.\n` +
        'Проверьте, что бот в чате, и дайте там команду /here: привязка восстановится.',
    );
  }
};

/** Общедомовое объявление уходит и в чат дома; адресное, только жильцам. */
export const postToChat = async (
  deps: AppDeps,
  announcement: Announcement,
  audience: AnnouncementAudience,
  post: ChatPost = {},
): Promise<void> => {
  if (audience.kind !== 'building') return;

  await postTextToChat(deps, announcement.buildingId, `${announcement.title}\n\n${announcement.body}`, post);
};

/** Объявление, которое уже завели по этой заявке. */
const announcedFor = async (deps: AppDeps, request: ServiceRequest): Promise<Announcement | undefined> =>
  (await deps.repository.listAnnouncements(request.buildingId)).find(
    (announcement) => announcement.requestId === request.id,
  );

/** Объявление о подтверждённой аварии: продукт публикует его сам. */
export const announceIncident = async (deps: AppDeps, request: ServiceRequest): Promise<Announcement | undefined> => {
  const audience = audienceForTarget(request.target);

  if (!audience) return undefined;

  if (await announcedFor(deps, request)) return undefined;

  const apartments = await deps.repository.listApartments(request.buildingId);
  const recipients = selectAudience(apartments, audience);
  const zone = await houseZone(deps, request.buildingId);

  const announcement = await deps.repository.saveAnnouncement({
    id: deps.createId(),
    buildingId: request.buildingId,
    audience: {
      kind: audience.kind,
      ...(audience.kind === 'entrance' || audience.kind === 'riser' ? { entrance: audience.entrance } : {}),
      ...(audience.kind === 'riser' ? { riser: audience.riser } : {}),
    },
    title: `Авария: ${CATEGORY_RULES[request.category].title.toLowerCase()}`,
    body:
      `${request.title}\n\n` +
      `Знаем и чиним, заявка ${request.number}. Срок: ${formatMomentAt(request.resolutionDueAt, zone)}.\n` +
      'Заводить свою заявку не нужно: сообщим, когда устраним.',
    createdAt: deps.now(),
    recipientIds: recipients.map((apartment) => apartment.id),
    requestId: request.id,
  });

  await postToChat(deps, announcement, audience, { pin: true });

  return announcement;
};

/** Авария устранена: сообщение уходит тому же адресату, что и объявление. */
export const announceResolved = async (deps: AppDeps, request: ServiceRequest): Promise<Announcement | undefined> => {
  const opened = await announcedFor(deps, request);

  if (!opened) return undefined;

  const announcement = await deps.repository.saveAnnouncement({
    id: deps.createId(),
    buildingId: request.buildingId,
    audience: opened.audience,
    title: `Устранено: ${CATEGORY_RULES[request.category].title.toLowerCase()}`,
    body: `${request.title}\n\nЗаявка ${request.number} закрыта. Если у вас всё ещё не работает, напишите.`,
    createdAt: deps.now(),
    recipientIds: opened.recipientIds,
  });

  await postToChat(deps, announcement, announcementAudience(announcement), { unpin: true });

  return announcement;
};
