import { randomInt } from 'node:crypto';

import { APARTMENT_CODE_ALPHABET, APARTMENT_CODE_LENGTH } from '@domovoy/domain';

/** Код квартиры: знаки берутся из криптографического источника случайности. */
export const createApartmentCode = (): string =>
  Array.from(
    { length: APARTMENT_CODE_LENGTH },
    () => APARTMENT_CODE_ALPHABET[randomInt(APARTMENT_CODE_ALPHABET.length)],
  ).join('');
