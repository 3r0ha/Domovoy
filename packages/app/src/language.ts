import { DEFAULT_LANGUAGE, isLanguage, translatorFor, type Language, type Translate } from '@domovoy/i18n';
import { DomainError } from '@domovoy/domain';

import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** На каком языке продукт говорит с этим человеком. */
export const languageOf = (resident: Resident | undefined): Language => resident?.language ?? DEFAULT_LANGUAGE;

/** Перевод для человека: без выбранного языка продукт говорит по-русски. */
export const speak = (resident: Resident | undefined): Translate => translatorFor(resident?.language);

/** Перевод на язык продукта: им говорят со сменой и с домовым чатом. */
export const speakDefault = (): Translate => translatorFor(DEFAULT_LANGUAGE);

/**
 * Число словами: «2 часа», «5 часов». Форма выбирается по правилам русского,
 * а словарь другого языка кладёт во все три ключа одну строку.
 */
export const counted = (t: Translate, prefix: string, count: number): string => {
  const tail = count % 100;
  const last = count % 10;
  const form = tail >= 11 && tail <= 14 ? 'many' : last === 1 ? 'one' : last >= 2 && last <= 4 ? 'few' : 'many';

  return t(`app.${prefix}.${form}`, { сколько: count });
};

/** Письменности, за которыми стоит один наш язык. */
const SCRIPTS: readonly { language: Language; letters: RegExp }[] = [
  { language: 'hy', letters: /[԰-֏]/u },
  { language: 'ka', letters: /[Ⴀ-ჿᲐ-Ჿ]/u },
  { language: 'zh', letters: /[一-鿿]/u },
];

/**
 * Буквы, которых нет у соседей по письменности. Порядок важен: таджикские
 * «ҳҷӣӯ» проверяются раньше казахского «ғ», общего у двух языков.
 */
const LETTERS: readonly { language: Language; letters: RegExp }[] = [
  { language: 'tg', letters: /[ҳҷӣӯ]/u },
  { language: 'kk', letters: /[ұіғ]/u },
  { language: 'tt', letters: /[җ]/u },
  { language: 'az', letters: /[əğ]/u },
  { language: 'tk', letters: /[ňýž]/u },
  { language: 'ro', letters: /[ăâîșț]/u },
  { language: 'uz', letters: /[og]ʻ/u },
];

/** Частые слова: ими язык узнаётся там, где особых букв не попалось. */
const WORDS: readonly { language: Language; words: RegExp }[] = [
  { language: 'uz', words: /(^|\P{L})(qanday|qayerda|qachon|nima|uchun|kerak|rahmat|iltimos|tilni|mening)(\P{L}|$)/u },
  { language: 'az', words: /(^|\P{L})(necə|harada|nədir|zaman|mənim|mənə|zəhmət|dili)(\P{L}|$)/u },
  { language: 'tk', words: /(^|\P{L})(nädip|nirede|haçan|näme|maňa|meniň|sagbol|haýyş)(\P{L}|$)/u },
  { language: 'ro', words: /(^|\P{L})(cum|unde|când|când|mulțumesc|factura|limba)(\P{L}|$)/u },
  { language: 'en', words: /(^|\P{L})(how|where|when|why|what|please|thanks|language|my)(\P{L}|$)/u },
  { language: 'tg', words: /(^|\P{L})(куҷо|кай|ташаккур|лутфан|забон|ман)(\P{L}|$)/u },
  { language: 'kk', words: /(^|\P{L})(қалай|қайда|қашан|маған|менің|рахмет|тілді)(\P{L}|$)/u },
  { language: 'ky', words: /(^|\P{L})(кандай|кайда|качан|эмне|мага|менин|рахмат|тилди)(\P{L}|$)/u },
  { language: 'tt', words: /(^|\P{L})(ничек|кайда|кайчан|нәрсә|миңа|минем|рәхмәт|телне)(\P{L}|$)/u },
  { language: 'ru', words: /(^|\P{L})(как|где|когда|почему|сколько|что|мне|мой|моя|спасибо|язык)(\P{L}|$)/u },
];

/**
 * Язык, на котором написан текст. Сначала письменность, потом буквы, которых
 * нет у соседей, потом частые слова. Незнакомый язык остаётся неизвестным:
 * отвечать на угаданном хуже, чем на выбранном.
 */
export const languageOfText = (text: string): Language | undefined => {
  const said = text.toLowerCase();

  for (const sign of SCRIPTS) if (sign.letters.test(said)) return sign.language;
  for (const sign of LETTERS) if (sign.letters.test(said)) return sign.language;
  for (const sign of WORDS) if (sign.words.test(said)) return sign.language;

  return undefined;
};

/** Выбран ли язык: до выбора продукт сначала спрашивает о нём. */
export const languageChosen = (resident: Resident): boolean => resident.language !== undefined;

/** Выбор языка. Он свой у каждого человека, а не у дома. @throws {DomainError} */
export const setLanguage = async (deps: AppDeps, resident: Resident, code: string): Promise<Resident> => {
  if (!isLanguage(code)) throw new DomainError('language_unknown', 'Такого языка у меня нет');

  return deps.repository.saveResident({ ...resident, language: code });
};
