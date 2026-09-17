import type {
  BiometryInfo,
  ContactResponse,
  ImpactStyle,
  LaunchContext,
  NfcInfo,
  NotificationType,
  ShareParams,
  ViewportSize,
} from './types.js';

type Empty = Record<string, never>;

/** События «запрос → ответ»: клиент отвечает по `requestId`. */
export interface RequestEventMap {
  WebAppSecureStorageSaveKey: { params: { key: string; value: string | null }; result: void };
  WebAppSecureStorageGetKey: { params: { key: string }; result: { value: string | null } };
  WebAppSecureStorageClear: { params: Empty; result: void };

  WebAppDeviceStorageSaveKey: { params: { key: string; value: string | null }; result: void };
  WebAppDeviceStorageGetKey: { params: { key: string }; result: { value: string | null } };
  WebAppDeviceStorageClear: { params: Empty; result: void };

  WebAppBiometryGetInfo: { params: Empty; result: BiometryInfo };
  WebAppBiometryRequestAccess: { params: { reason?: string }; result: BiometryInfo };
  WebAppBiometryRequestAuth: { params: { reason?: string }; result: { token?: string } };
  WebAppBiometryUpdateToken: { params: { token?: string; reason?: string }; result: { status: string } };
  WebAppBiometryOpenSettings: { params: Empty; result: { status: 'opened' } };

  WebAppNfcGetInfo: { params: Empty; result: NfcInfo };
  WebAppNfcEmulateNfcTag: { params: { nfctag?: string }; result: void };
  WebAppNfcOpenSystemSettings: { params: Empty; result: { status: 'opened' } };

  WebAppHapticFeedbackImpact: { params: { impactStyle: ImpactStyle; disableVibrationFallback: boolean }; result: void };
  WebAppHapticFeedbackNotification: {
    params: { notificationType: NotificationType; disableVibrationFallback: boolean };
    result: void;
  };
  WebAppHapticFeedbackSelectionChange: { params: { disableVibrationFallback: boolean }; result: void };

  WebAppSetupSwipesBehavior: { params: { allowVerticalSwipes: boolean }; result: { allowVerticalSwipes: boolean } };
  WebAppSetupScreenCaptureBehavior: {
    params: { isScreenCaptureEnabled: boolean };
    result: { isScreenCaptureEnabled: boolean };
  };
  WebAppChangeScreenBrightness: { params: { maxBrightness: boolean }; result: { maxBrightness: boolean } };

  WebAppRequestPhone: { params: Empty; result: ContactResponse };
  WebAppGetViewportSize: { params: Empty; result: ViewportSize };
  WebAppGetLaunchContext: { params: Empty; result: LaunchContext };
  WebAppDownloadFile: { params: { url: string; file_name: string }; result: void };
  WebAppShare: { params: ShareParams; result: void };
  WebAppMaxShare: { params: ShareParams | { chatId: string; messageId: string }; result: void };
  WebAppOpenCodeReader: { params: { fileSelect: boolean }; result: { code?: string } & Record<string, unknown> };
}

/** События без ответа. */
export interface NotificationEventMap {
  WebAppReady: Empty;
  WebAppClose: Empty;
  WebAppSetupBackButton: { isVisible: boolean };
  WebAppSetupClosingBehavior: { needConfirmation: boolean };
  WebAppOpenLink: { url: string };
  WebAppOpenMaxLink: { url: string };
}

/** События, которые присылает клиент MAX по своей инициативе. */
export interface IncomingEventMap {
  WebAppBackButtonPressed: Record<string, unknown>;
}

export type RequestEvent = keyof RequestEventMap;
export type NotificationEvent = keyof NotificationEventMap;
export type IncomingEvent = keyof IncomingEventMap;

/** Запросы, которым клиент подмешивает `query_id` из initData. */
export const QUERY_ID_EVENTS: readonly RequestEvent[] = [
  'WebAppSecureStorageSaveKey',
  'WebAppSecureStorageGetKey',
  'WebAppSecureStorageClear',
  'WebAppDeviceStorageSaveKey',
  'WebAppDeviceStorageGetKey',
  'WebAppDeviceStorageClear',
  'WebAppBiometryGetInfo',
  'WebAppBiometryRequestAccess',
  'WebAppBiometryRequestAuth',
  'WebAppBiometryUpdateToken',
  'WebAppBiometryOpenSettings',
  'WebAppNfcGetInfo',
  'WebAppNfcEmulateNfcTag',
  'WebAppNfcOpenSystemSettings',
];

export const DEFAULT_TIMEOUT_MS = 10_000;
export const NFC_TIMEOUT_MS = 30_000;
export const LONG_TIMEOUT_MS = 60_000;
export const CODE_READER_TIMEOUT_MS = 600_000;

export const EVENT_TIMEOUTS: Partial<Record<RequestEvent, number>> = {
  WebAppNfcEmulateNfcTag: NFC_TIMEOUT_MS,
  WebAppBiometryRequestAccess: LONG_TIMEOUT_MS,
  WebAppBiometryRequestAuth: LONG_TIMEOUT_MS,
  WebAppBiometryUpdateToken: LONG_TIMEOUT_MS,
  WebAppBiometryOpenSettings: LONG_TIMEOUT_MS,
  WebAppRequestPhone: LONG_TIMEOUT_MS,
  WebAppDownloadFile: LONG_TIMEOUT_MS,
  WebAppShare: LONG_TIMEOUT_MS,
  WebAppMaxShare: LONG_TIMEOUT_MS,
  WebAppOpenCodeReader: CODE_READER_TIMEOUT_MS,
};
