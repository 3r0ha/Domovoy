export {
  FEATURE_SUPPORT,
  compareVersions,
  isVersionAtLeast,
  supportsFeature,
  type CapabilityContext,
  type FeatureRequirement,
  type MaxFeature,
} from './capabilities.js';
export { MaxBridge, createBridge, getBridge, resetBridge, type BridgeOptions } from './client.js';
export { MaxBridgeError, methodSlug, toBridgeError } from './errors.js';
export {
  CODE_READER_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  EVENT_TIMEOUTS,
  LONG_TIMEOUT_MS,
  NFC_TIMEOUT_MS,
  QUERY_ID_EVENTS,
  type IncomingEvent,
  type IncomingEventMap,
  type NotificationEvent,
  type NotificationEventMap,
  type RequestEvent,
  type RequestEventMap,
} from './events.js';
export {
  HASH_KEYS,
  buildInitData,
  buildLaunchHash,
  parseInitData,
  parseInitDataEntries,
  readLaunchParams,
  type LaunchParamsSource,
} from './launch-params.js';
export { BiometricManager } from './modules/biometry.js';
export { NfcManager } from './modules/nfc.js';
export { BridgeStorage, createDeviceStorage, createSecureStorage } from './modules/storage.js';
export { BackButton, HapticFeedback, ScreenCapture, SwipesBehavior } from './modules/ui.js';
export { RequestController, type RequestFn, type RequestOptions } from './request-controller.js';
export {
  SECRET_KEY_SALT,
  buildDataCheckString,
  computeInitDataHash,
  signInitData,
  type DataCheckResult,
} from './signature.js';
export {
  LOCAL_DEV_ORIGINS,
  MAX_ORIGIN_PATTERN,
  createIframeTransport,
  createNoopTransport,
  createWebViewTransport,
  detectTransport,
  type BridgeMessageHandler,
  type BridgeTransport,
  type IframeTransportOptions,
  type WebAppReceiver,
  type WebViewGlobal,
  type WebViewHandler,
  type WindowLike,
} from './transport.js';
export type {
  BiometricType,
  BiometryInfo,
  ContactResponse,
  ImpactStyle,
  InitData,
  InitDataChat,
  InitDataUser,
  LaunchContext,
  LaunchParams,
  MaxChatType,
  MaxPlatform,
  MaxShareParams,
  NfcInfo,
  NotificationType,
  ShareParams,
  ViewportSize,
} from './types.js';
export { VALID_PLATFORMS } from './types.js';
