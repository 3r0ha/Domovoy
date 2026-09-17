/** Каноническая часть проверки подписи `initData`, общая для клиента и сервера. */

export const SECRET_KEY_SALT = 'WebAppData';

export interface DataCheckResult {
  /** Строка `launch_params`, по которой считается подпись. */
  dataCheckString: string;
  /** Значение параметра `hash` из initData, если оно было. */
  hash: string | null;
  /** Сколько раз встретился параметр `hash`: больше одного, попытка подмены. */
  hashCount: number;
  /** Те самые пары, по которым посчитана подпись: данные берутся только из них. */
  params: URLSearchParams;
}

/** Собирает строку для проверки подписи из сырого `WebAppData`. */
export const buildDataCheckString = (initData: string): DataCheckResult => {
  const params = new URLSearchParams(initData);
  const pairs: string[] = [];
  let hash: string | null = null;
  let hashCount = 0;

  for (const [key, value] of params) {
    if (key === 'hash') {
      hash = value;
      hashCount += 1;
      continue;
    }
    pairs.push(`${key}=${value}`);
  }

  return { dataCheckString: pairs.sort().join('\n'), hash, hashCount, params };
};

const encoder = new TextEncoder();

const importKey = (secret: ArrayBuffer | Uint8Array | string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'raw',
    typeof secret === 'string' ? encoder.encode(secret) : (secret as BufferSource),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

const hmac = async (secret: ArrayBuffer | Uint8Array | string, data: string): Promise<ArrayBuffer> =>
  crypto.subtle.sign('HMAC', await importKey(secret), encoder.encode(data));

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Считает ожидаемый `hash` для строки запуска через Web Crypto. */
export const computeInitDataHash = async (dataCheckString: string, botToken: string): Promise<string> => {
  const secretKey = await hmac(SECRET_KEY_SALT, botToken);
  return toHex(await hmac(secretKey, dataCheckString));
};

/** Подпись телефона из `requestContact`: секрет, сам токен бота, без соли. */
export const signPhone = async (
  input: { phone: string; authDate: string; userId: number | string },
  botToken: string,
): Promise<string> => {
  const phone = input.phone.replace(/^\+/, '');
  const dataCheckString = [`authDate=${input.authDate}`, `phone=${phone}`, `userId=${input.userId}`].sort().join('\n');

  return toHex(await hmac(botToken, dataCheckString));
};

/** Подписывает набор параметров и возвращает готовую строку `WebAppData`. */
export const signInitData = async (
  params: Record<string, string | number | undefined>,
  botToken: string,
): Promise<string> => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || key === 'hash') continue;
    search.set(key, String(value));
  }

  const { dataCheckString } = buildDataCheckString(search.toString());
  search.set('hash', await computeInitDataHash(dataCheckString, botToken));
  return search.toString();
};
