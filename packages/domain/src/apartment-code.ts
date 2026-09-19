/**
 * Код квартиры: им жилец подтверждает, что квартира его. Компания печатает код
 * в квитанции, поэтому из номера квартиры и её идентификатора он не выводится.
 */

/** Знаки кода: похожие друг на друга исключены, чтобы не ошибиться при наборе. */
export const APARTMENT_CODE_ALPHABET = 'ACEFHKLMNPRTUVWXY34789';

export const APARTMENT_CODE_LENGTH = 8;

/** Приставка параметра запуска, по которому квартира привязывается. */
export const APARTMENT_KEY_PREFIX = 'key_';

const CODE = new RegExp(`^[${APARTMENT_CODE_ALPHABET}]{${APARTMENT_CODE_LENGTH}}$`);

/** Набранное человеком приводится к виду хранения: регистр и пробелы не важны. */
export const normalizeApartmentCode = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(new RegExp(`^${APARTMENT_KEY_PREFIX.toUpperCase()}`), '')
    .replace(/[^A-Z0-9]/g, '');

export const isApartmentCode = (value: string): boolean => CODE.test(value);

/** Параметр запуска с кодом квартиры. */
export const apartmentKeyParam = (code: string): string => `${APARTMENT_KEY_PREFIX}${code}`;

/** Код из параметра запуска. Пусто, если параметр не о квартире. */
export const apartmentKeyOf = (payload: string | null | undefined): string | null => {
  // Регистр приставки не важен: код набирают с бумажной квитанции вручную.
  if (!payload?.trim().toLowerCase().startsWith(APARTMENT_KEY_PREFIX)) return null;

  const code = normalizeApartmentCode(payload);

  return isApartmentCode(code) ? code : null;
};

/**
 * Код из случайной строки. Источник случайности задаёт запускающая сторона:
 * готовый код возвращается как есть, иначе знаки берутся из строки-семени.
 */
export const apartmentCodeFrom = (seed: string): string => {
  const clean = seed.replace(/[^0-9a-z]/gi, '').toUpperCase();

  if (isApartmentCode(clean)) return clean;

  let code = '';

  for (let index = 0; code.length < APARTMENT_CODE_LENGTH; index += 1) {
    const pair = clean.slice(index * 2, index * 2 + 2) || String(index);
    const value = Number.parseInt(pair, 36);
    const shift = Number.isNaN(value) ? index : value;

    code += APARTMENT_CODE_ALPHABET[(shift + index) % APARTMENT_CODE_ALPHABET.length];
  }

  return code;
};
