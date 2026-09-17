import type { InitData, InitDataChat, InitDataUser, LaunchParams, MaxPlatform } from './types.js';
import { VALID_PLATFORMS } from './types.js';

export const HASH_KEYS = {
  data: 'WebAppData',
  platform: 'WebAppPlatform',
  version: 'WebAppVersion',
  deviceName: 'WebAppDeviceName',
} as const;

const readHashParam = (hash: string, key: string): string | null => {
  try {
    return new URLSearchParams(hash.replace(/^#/, '')).get(key);
  } catch {
    return null;
  }
};

export interface LaunchParamsSource {
  /** Явный hash, приоритетнее `location.hash`. Нужен тестам и восстановлению сессии. */
  hash?: string;
  /** Полный URL запуска, если hash уже затёрт роутером. */
  url?: string;
  /** Хранилище-кеш. По умолчанию `sessionStorage`, `null` отключает кеширование. */
  storage?: Storage | null;
}

/** Все места, где может лежать hash запуска, в порядке убывания приоритета. */
const collectHashes = (source: LaunchParamsSource): string[] => {
  const hashes: string[] = [];

  if (source.hash) hashes.push(source.hash);

  if (source.url) {
    try {
      hashes.push(new URL(source.url).hash);
    } catch {
      /* некорректный URL, просто пропускаем источник */
    }
  }

  if (!source.hash && typeof location !== 'undefined') hashes.push(location.hash);

  if (!source.url && typeof performance !== 'undefined') {
    try {
      const [navigation] = performance.getEntriesByType('navigation');
      if (navigation) hashes.push(new URL(navigation.name).hash);
    } catch {
      /* Navigation Timing недоступен */
    }
  }

  return hashes;
};

/** Клиент MAX кладёт параметры запуска в hash. */
const readParam = (key: string, hashes: string[], storage: Storage | null): string | null => {
  for (const hash of hashes) {
    const value = readHashParam(hash, key);
    if (!value) continue;

    try {
      storage?.setItem(key, value);
    } catch {
      /* приватный режим, просто не кешируем */
    }
    return value;
  }

  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const parseUser = (raw: string): InitDataUser | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const user = parsed as Record<string, unknown>;
    return {
      id: Number(user['id']),
      first_name: typeof user['first_name'] === 'string' ? user['first_name'] : undefined,
      last_name: typeof user['last_name'] === 'string' ? user['last_name'] : undefined,
      username: typeof user['username'] === 'string' ? user['username'] : undefined,
      language_code: typeof user['language_code'] === 'string' ? user['language_code'] : undefined,
      photo_url: typeof user['photo_url'] === 'string' ? user['photo_url'] : undefined,
    };
  } catch {
    return undefined;
  }
};

const parseChat = (raw: string): InitDataChat | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const chat = parsed as Record<string, unknown>;
    if (chat['id'] === undefined || typeof chat['type'] !== 'string') return undefined;
    return { id: chat['id'] as number | string, type: chat['type'] as InitDataChat['type'] };
  } catch {
    return undefined;
  }
};

/** Собирает `InitData` из уже разобранных пар. */
export const parseInitDataEntries = (entries: Iterable<[string, string]>): InitData => {
  const result: InitData & Record<string, unknown> = {};

  for (const [key, value] of entries) {
    switch (key) {
      case 'auth_date':
        result.auth_date = Number(value);
        break;
      case 'user':
        result.user = parseUser(value);
        break;
      case 'chat':
        result.chat = parseChat(value);
        break;
      default:
        result[key] = value;
    }
  }

  return result;
};

/** Разбирает сырую строку `WebAppData`. */
export const parseInitData = (raw: string | null | undefined): InitData => {
  if (!raw) return {};

  try {
    return parseInitDataEntries(new URLSearchParams(raw));
  } catch {
    /* битые параметры запуска не должны ронять приложение */
    return {};
  }
};

const isPlatform = (value: string | null): value is MaxPlatform =>
  value !== null && (VALID_PLATFORMS as readonly string[]).includes(value);

export const readLaunchParams = (source: LaunchParamsSource = {}): LaunchParams => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const storage = source.storage === undefined ? (globalThis.sessionStorage ?? null) : source.storage;
  const hashes = collectHashes(source);

  const initData = readParam(HASH_KEYS.data, hashes, storage);
  const platform = readParam(HASH_KEYS.platform, hashes, storage);

  return {
    initData,
    initDataUnsafe: parseInitData(initData),
    platform: isPlatform(platform) ? platform : null,
    version: readParam(HASH_KEYS.version, hashes, storage),
    deviceName: readParam(HASH_KEYS.deviceName, hashes, storage),
  };
};

/** Собирает hash запуска, им devhost открывает приложение, а тесты воспроизводят реальный вход. */
export const buildLaunchHash = (params: LaunchParams): string => {
  const search = new URLSearchParams();

  if (params.initData) search.set(HASH_KEYS.data, params.initData);
  if (params.platform) search.set(HASH_KEYS.platform, params.platform);
  if (params.version) search.set(HASH_KEYS.version, params.version);
  if (params.deviceName) search.set(HASH_KEYS.deviceName, params.deviceName);

  return `#${search.toString()}`;
};

/** Собирает строку запуска, нужно эмулятору `@maxkit/devhost` и тестам. */
export const buildInitData = (data: InitData): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return params.toString();
};
