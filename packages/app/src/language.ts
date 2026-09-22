import {
  DEFAULT_LANGUAGE,
  counted as countedIn,
  isLanguage,
  translatorFor,
  type Language,
  type Translate,
} from '@domovoy/i18n';
import { DomainError } from '@domovoy/domain';

import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/**
 * На каком языке продукт говорит с этим человеком. Язык есть только у жильца:
 * смена и подрядчик работают по-русски, на нём же ведётся очередь и отчётность.
 */
export const languageOf = (resident: Resident | undefined): Language =>
  (resident?.role === 'resident' ? resident.language : undefined) ?? DEFAULT_LANGUAGE;

/**
 * На каком языке писать тому, кто прислал этот текст. Выбранный язык важнее:
 * человек его назвал сам. Не выбран, значит язык называют его же слова, и
 * жилец, написавший по-узбекски, читает вопрос по-узбекски, а не по-русски.
 */
export const languageHeard = (resident: Resident | undefined, text: string): Language => {
  const chosen = resident?.role === 'resident' ? resident.language : undefined;

  return chosen ?? (resident?.role === 'resident' ? languageOfText(text) : undefined) ?? DEFAULT_LANGUAGE;
};

/** Перевод для человека: без выбранного языка продукт говорит по-русски. */
export const speak = (resident: Resident | undefined): Translate => translatorFor(languageOf(resident));

/** Перевод на язык продукта: им говорят со сменой и с домовым чатом. */
export const speakDefault = (): Translate => translatorFor(DEFAULT_LANGUAGE);

/**
 * Число словами: «2 часа», «5 часов», «2 hours». Форма выбирается по правилам
 * самого языка, а словарь языка без трёх форм кладёт во все три ключа одну строку.
 */
export const counted = (t: Translate, prefix: string, count: number): string =>
  countedIn(t, `app.${prefix}`, count);

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
  {
    language: 'uz',
    words:
      /(^|\P{L})(qanday|qayerda|qachon|nima|uchun|kerak|rahmat|iltimos|tilni|mening|eshik|eshikni|oching|suv|yordam|hisob)(\P{L}|$)/u,
  },
  { language: 'az', words: /(^|\P{L})(necə|harada|nədir|zaman|mənim|mənə|zəhmət|dili)(\P{L}|$)/u },
  { language: 'tk', words: /(^|\P{L})(nädip|nirede|haçan|näme|maňa|meniň|sagbol|haýyş)(\P{L}|$)/u },
  { language: 'ro', words: /(^|\P{L})(cum|unde|când|când|mulțumesc|factura|limba)(\P{L}|$)/u },
  {
    language: 'en',
    words:
      /(^|\P{L})(how|where|when|why|what|please|thanks|language|my|the|is|are|do|does|can|want|need|help|hello|water)(\P{L}|$)/u,
  },
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

  // Особых букв и частых слов не нашлось: «хочу заплатить за счета» написано
  // кириллицей без единой приметы. У кириллицы это русский: у остальных наших
  // языков с этой письменностью есть свои буквы, и они проверены выше.
  // Латиницу так не угадывают: за ней стоит слишком много чужих языков.
  return /\p{Script=Cyrillic}/u.test(said) ? 'ru' : undefined;
};

/** Выбран ли язык: до выбора продукт сначала спрашивает о нём. Смену не спрашивают. */
export const languageChosen = (resident: Resident): boolean =>
  resident.role !== 'resident' || resident.language !== undefined;

/** Выбор языка. Он свой у каждого человека, а не у дома. @throws {DomainError} */
export const setLanguage = async (deps: AppDeps, resident: Resident, code: string): Promise<Resident> => {
  if (!isLanguage(code)) throw new DomainError('language_unknown', 'Такого языка у меня нет');

  return deps.repository.saveResident({ ...resident, language: code });
};
