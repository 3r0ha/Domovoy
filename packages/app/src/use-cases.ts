/**
 * Сценарии продукта: зависимости слоя, права на заявку, работа с заявками
 * и объявления.
 */

export {
  assertMayTargetApartment,
  assertStaffServes,
  canAct,
  canActNow,
  canView,
} from './use-cases/access.js';
export {
  listAnnouncementsFor,
  NEWS_PAGE,
  publishAnnouncement,
  type AnnouncementCommand,
} from './use-cases/announcements.js';
export {
  aimBroadcast,
  broadcastTargets,
  sendBroadcast,
  type BroadcastAim,
  type BroadcastCommand,
  type BroadcastEntrance,
  type BroadcastResult,
  type BroadcastRiser,
  type BroadcastTargets,
} from './use-cases/broadcast.js';
export { type AppDeps, type Lock, type RequestPage } from './use-cases/deps.js';
export { describeContext, ensureResident, type ContextDescription } from './use-cases/entry.js';
export {
  CLOSED_PAGE,
  commentRequest,
  createServiceRequest,
  getRequestFor,
  listRequestsFor,
  targetOf,
  transitionRequest,
  withReadableAddress,
  type CommentCommand,
  type CreateRequestCommand,
  type RequestScope,
  type TransitionCommand,
} from './use-cases/requests.js';
