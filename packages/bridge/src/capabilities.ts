import type { MaxPlatform } from './types.js';

/** Возможности клиента MAX, доступность которых зависит от платформы. */
export type MaxFeature =
  | 'backButton'
  | 'biometry'
  | 'closingConfirmation'
  | 'codeReader'
  | 'deviceStorage'
  | 'downloadFile'
  | 'haptics'
  | 'nfc'
  | 'requestContact'
  | 'screenBrightness'
  | 'screenCapture'
  | 'secureStorage'
  | 'shareNative'
  | 'shareToMax'
  | 'verticalSwipes'
  | 'viewportSize';

export interface FeatureRequirement {
  /** Платформы, где возможность есть. `undefined`, везде. */
  platforms?: readonly MaxPlatform[];
  /** Минимальная версия клиента. `undefined`, ограничение неизвестно. */
  minVersion?: string;
}

const MOBILE: readonly MaxPlatform[] = ['ios', 'android'];

export const FEATURE_SUPPORT: Readonly<Record<MaxFeature, FeatureRequirement>> = {
  nfc: { platforms: ['android'] },
  biometry: { platforms: MOBILE },
  haptics: { platforms: MOBILE },
  shareNative: { platforms: MOBILE },
  screenBrightness: { platforms: MOBILE },
  verticalSwipes: { platforms: MOBILE },

  backButton: {},
  closingConfirmation: {},
  codeReader: {},
  deviceStorage: {},
  downloadFile: {},
  requestContact: {},
  screenCapture: {},
  secureStorage: {},
  shareToMax: {},
  viewportSize: {},
};

const parseVersion = (version: string): number[] =>
  version
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isNaN(part) ? 0 : part));

/** Сравнивает версии клиента: -1, 0 или 1. Формат, `25.9.16`. */
export const compareVersions = (left: string, right: string): -1 | 0 | 1 => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const partA = a[index] ?? 0;
    const partB = b[index] ?? 0;
    if (partA > partB) return 1;
    if (partA < partB) return -1;
  }

  return 0;
};

/** Версия клиента не ниже требуемой. Неизвестная версия считается достаточной. */
export const isVersionAtLeast = (current: string | null | undefined, required: string): boolean => {
  if (!current) return true;
  return compareVersions(current, required) >= 0;
};

export interface CapabilityContext {
  platform: MaxPlatform | null;
  version: string | null;
}

/** Доступна ли возможность на текущем клиенте. */
export const supportsFeature = (feature: MaxFeature, context: CapabilityContext): boolean => {
  const requirement = FEATURE_SUPPORT[feature];

  if (requirement.platforms && context.platform && !requirement.platforms.includes(context.platform)) {
    return false;
  }

  if (requirement.minVersion && !isVersionAtLeast(context.version, requirement.minVersion)) {
    return false;
  }

  return true;
};
