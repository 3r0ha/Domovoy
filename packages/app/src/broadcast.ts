import { CATEGORY_RULES, audienceForTarget, formatMoment, selectAudience } from '@domovoy/domain';
import type { AnnouncementAudience, ServiceRequest } from '@domovoy/domain';

import { noopNotifier } from './notifier.js';
import { announcementAudience, type Announcement } from './repository.js';
import type { AppDeps } from './use-cases.js';

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

    if (post.pin && messageId && notifier.pinInChat) await notifier.pinInChat(chatId, messageId);
  } catch (error) {
    notifier.onError?.(error);
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

/** Объявление о подтверждённой аварии: продукт публикует его сам. */
export const announceIncident = async (deps: AppDeps, request: ServiceRequest): Promise<Announcement | undefined> => {
  const audience = audienceForTarget(request.target);

  if (!audience) return undefined;

  const known = await deps.repository.listAnnouncements(request.buildingId);

  if (known.some((announcement) => announcement.requestId === request.id)) return undefined;

  const apartments = await deps.repository.listApartments(request.buildingId);
  const recipients = selectAudience(apartments, audience);

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
      `Знаем и чиним, заявка ${request.number}. Срок: ${formatMoment(request.resolutionDueAt)}.\n` +
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
  const known = await deps.repository.listAnnouncements(request.buildingId);
  const opened = known.find((announcement) => announcement.requestId === request.id);

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
