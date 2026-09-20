import { DEFAULT_LANGUAGE, type Language } from '../languages.js';
import { translator, type Dictionary, type Translate } from '../translate.js';
import { az } from './az/index.js';
import { en } from './en/index.js';
import { hy } from './hy/index.js';
import { ka } from './ka/index.js';
import { kk } from './kk/index.js';
import { ky } from './ky/index.js';
import { ro } from './ro/index.js';
import { ru } from './ru/index.js';
import { tg } from './tg/index.js';
import { tk } from './tk/index.js';
import { tt } from './tt/index.js';
import { uz } from './uz/index.js';
import { zh } from './zh/index.js';

/**
 * Словари языков. Русский собран из исходных строк продукта, остальные
 * переведены с него: перевод лежит рядом файлом на язык.
 */
export const DICTIONARIES: Readonly<Partial<Record<Language, Dictionary>>> & { ru: Dictionary } = {
  ru,
  en,
  tt,
  uz,
  tg,
  ky,
  kk,
  az,
  hy,
  tk,
  ka,
  ro,
  zh,
};

export const dictionaryFor = (language: Language): Dictionary => DICTIONARIES[language] ?? DICTIONARIES.ru;

/** Перевод на язык человека. Без языка продукт говорит по-русски. */
export const translatorFor = (language: Language | undefined): Translate =>
  translator(language ?? DEFAULT_LANGUAGE, { dictionaries: DICTIONARIES });
