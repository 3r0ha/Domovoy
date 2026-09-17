export type MaxPlatform = 'ios' | 'android' | 'desktop' | 'web';

export const VALID_PLATFORMS: readonly MaxPlatform[] = ['ios', 'android', 'desktop', 'web'];

export type MaxChatType = 'DIALOG' | 'CHAT' | 'CHANNEL';

export interface InitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface InitDataChat {
  id: number | string;
  type: MaxChatType;
}

/** Разобранный `WebAppData`. Доверять этим полям можно только после серверной проверки подписи. */
export interface InitData {
  hash?: string;
  ip?: string;
  query_id?: string;
  start_param?: string;
  auth_date?: number;
  user?: InitDataUser;
  chat?: InitDataChat;
}

export interface LaunchParams {
  /** Сырая строка `WebAppData`, именно она уходит на сервер для проверки подписи. */
  initData: string | null;
  initDataUnsafe: InitData;
  platform: MaxPlatform | null;
  version: string | null;
  deviceName: string | null;
}

export type BiometricType = 'finger' | 'face' | 'unknown';

export interface BiometryInfo {
  available: boolean;
  accessRequested: boolean;
  accessGranted: boolean;
  type: BiometricType[];
  tokenSaved: boolean;
  deviceId: string | null;
}

export interface NfcInfo {
  available: boolean;
  enabled: boolean;
  accessRevoked: boolean;
}

export type ImpactStyle = 'soft' | 'light' | 'medium' | 'heavy' | 'rigid';
export type NotificationType = 'error' | 'success' | 'warning';

export interface ContactResponse {
  phone: string;
  authDate: string;
  hash: string;
}

export interface ViewportSize {
  height: string;
  width: string;
}

export interface LaunchContext {
  entryPoint: 'tabbar' | 'default';
}

export type ShareParams = { text?: string; link?: string };
export type MaxShareParams = ShareParams | { mid: string; chatType: Exclude<MaxChatType, 'CHANNEL'> };
