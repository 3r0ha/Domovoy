import { createHmac, timingSafeEqual } from 'node:crypto';

import { SECRET_KEY_SALT, buildDataCheckString, parseInitDataEntries, type InitData } from '@maxkit/bridge';

export type InitDataErrorCode =
  | 'init_data_missing'
  | 'init_data_malformed'
  | 'init_data_invalid_hash'
  | 'init_data_expired';

export class InitDataError extends Error {
  readonly code: InitDataErrorCode;
  /** HTTP-статус: клиенту не нужны детали, но 401 отличается от 400. */
  readonly statusCode: number;

  constructor(code: InitDataErrorCode, message: string, statusCode = 401) {
    super(message);
    this.name = 'InitDataError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ValidateInitDataOptions {
  /** Токен бота, к которому привязано мини-приложение. */
  botToken: string;
  /** Максимальный возраст параметров запуска в секундах. */
  maxAgeSeconds?: number;
  /** Допуск на расхождение часов клиента и сервера, секунды. */
  clockSkewSeconds?: number;
  /** Подменяемые часы, для детерминированных тестов. */
  now?: () => number;
}

export interface ValidatedInitData {
  /** Разобранные и уже проверенные данные запуска. */
  data: InitData;
  /** Идентификатор пользователя MAX, основной ключ авторизации. */
  userId: number;
  /** Сырая строка: пригодится для логов и отладки. */
  raw: string;
}

const DEFAULT_MAX_AGE_SECONDS = 3600;
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

/** secret_key = HMAC_SHA256(key: "WebAppData", data: BOT_TOKEN) */
const deriveSecretKey = (botToken: string): Buffer =>
  createHmac('sha256', SECRET_KEY_SALT).update(botToken).digest();

const HEX = /^[0-9a-f]*$/i;

/**
 * Сравнение подписей. Длина считается в байтах, а не в символах: `timingSafeEqual`
 * на буферах разной длины бросает исключение, и не-hex символы дают короткий буфер.
 */
const equalHex = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  if (!HEX.test(left) || !HEX.test(right)) return false;

  const first = Buffer.from(left, 'hex');
  const second = Buffer.from(right, 'hex');

  if (first.length !== second.length) return false;

  return timingSafeEqual(first, second);
};

/** Проверяет подпись параметров запуска мини-приложения. @throws {InitDataError} */
export const validateInitData = (
  initData: string | null | undefined,
  options: ValidateInitDataOptions,
): ValidatedInitData => {
  if (!initData) {
    throw new InitDataError('init_data_missing', 'Параметры запуска не переданы');
  }

  const { dataCheckString, hash, hashCount, params } = buildDataCheckString(initData);

  if (!hash || hashCount !== 1) {
    throw new InitDataError('init_data_malformed', 'Параметр hash отсутствует или встречается несколько раз');
  }

  if (!/^[0-9a-f]+$/i.test(hash)) {
    throw new InitDataError('init_data_malformed', 'Параметр hash не является hex-строкой');
  }

  const expected = createHmac('sha256', deriveSecretKey(options.botToken)).update(dataCheckString).digest('hex');

  if (!equalHex(expected, hash.toLowerCase())) {
    throw new InitDataError('init_data_invalid_hash', 'Подпись параметров запуска не совпадает');
  }

  const data = parseInitDataEntries(params);
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  if (maxAge > 0) {
    const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
    const authDate = data.auth_date;
    const skew = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;

    if (typeof authDate !== 'number' || Number.isNaN(authDate)) {
      throw new InitDataError('init_data_malformed', 'Отсутствует корректный auth_date');
    }

    if (authDate > now + skew) {
      throw new InitDataError('init_data_malformed', 'auth_date из будущего');
    }

    if (now - authDate > maxAge) {
      throw new InitDataError('init_data_expired', 'Параметры запуска просрочены, перезапустите мини-приложение');
    }
  }

  const userId = data.user?.id;

  if (typeof userId !== 'number' || !Number.isFinite(userId)) {
    throw new InitDataError('init_data_malformed', 'В параметрах запуска нет идентификатора пользователя');
  }

  return { data, userId, raw: initData };
};

export interface VerifyContactOptions {
  botToken: string;
  /** Телефон из ответа `requestContact()`, без ведущего «+». */
  phone: string;
  authDate: string;
  userId: number | string;
  hash: string;
}

/** Проверяет телефон, полученный через `WebApp.requestContact()`. */
export const verifyContact = ({ botToken, phone, authDate, userId, hash }: VerifyContactOptions): boolean => {
  const normalizedPhone = phone.replace(/^\+/, '');
  const dataCheckString = [`authDate=${authDate}`, `phone=${normalizedPhone}`, `userId=${userId}`].sort().join('\n');
  const expected = createHmac('sha256', botToken).update(dataCheckString).digest('hex');

  return equalHex(expected, hash.toLowerCase());
};
