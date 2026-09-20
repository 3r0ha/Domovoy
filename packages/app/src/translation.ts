import { DEFAULT_LANGUAGE, type Language } from '@domovoy/i18n';
import type { OriginalText } from '@domovoy/domain';

import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/**
 * Порт перевода произвольного текста. Интерфейс продукта переведён словарями,
 * а здесь переводится то, что человек написал своими словами.
 */
export interface TextTranslator {
  /** Перевод делает модель: обращение к ней стоит времени и денег. */
  readonly model?: boolean;
  /**
   * Перевод текста. Пусто означает, что перевести не удалось: вызывающий
   * остаётся с исходным текстом и сценарий не прерывается.
   */
  translate(text: string, to: Language, from?: Language): Promise<string | undefined>;
}

const LETTER = /\p{L}/u;
const RUSSIAN_LETTER = /[а-яёА-ЯЁ]/u;

/**
 * Написано ли по-русски. Буква вне русского алфавита выдаёт и латиницу,
 * и кириллицу соседних языков: «ғ», «ә», «ӯ», «ң». Текст без букв переводить
 * нечего, поэтому он считается русским.
 */
export const isRussianText = (text: string): boolean => {
  for (const char of text) {
    if (LETTER.test(char) && !RUSSIAN_LETTER.test(char)) return false;
  }

  return true;
};

/** Русский текст и то, что человек написал сам, если это разные тексты. */
export interface Translated {
  text: string;
  original?: OriginalText;
}

/**
 * Обращение по-русски: по нему работает смена, по нему же считаются категория,
 * срок и поиск. Отказ службы перевода оставляет исходный текст: заявка человеку
 * нужнее отказа.
 */
export const intoRussian = async (
  deps: AppDeps,
  language: Language | undefined,
  text: string,
): Promise<Translated> => {
  if (!deps.translate || !language || language === DEFAULT_LANGUAGE) return { text };
  if (isRussianText(text)) return { text };

  const said = (await deps.translate.translate(text, DEFAULT_LANGUAGE, language).catch(() => undefined))?.trim();

  if (!said || said === text.trim()) return { text };

  return { text: said, original: { text, language } };
};

/**
 * Текст жильцу на его языке. Перевод делается до доставки: канал уведомлений
 * получает готовую строку и о языках ничего не знает.
 */
export const intoLanguage = async (
  deps: AppDeps,
  resident: Resident | undefined,
  text: string,
): Promise<string> => {
  const language = resident?.language;

  if (!deps.translate || !language || language === DEFAULT_LANGUAGE) return text;

  const said = (await deps.translate.translate(text, language, DEFAULT_LANGUAGE).catch(() => undefined))?.trim();

  return said || text;
};

/** Языки в родительном падеже: пометка о переводе пишется смене по-русски. */
const TRANSLATED_FROM: Record<Language, string> = {
  ru: 'русского',
  en: 'английского',
  tt: 'татарского',
  uz: 'узбекского',
  tg: 'таджикского',
  ky: 'киргизского',
  kk: 'казахского',
  az: 'азербайджанского',
  hy: 'армянского',
  tk: 'туркменского',
  ka: 'грузинского',
  ro: 'румынского',
  zh: 'китайского',
};

/** Пометка о переводе: смена видит, что текст не тот, который написал человек. */
export const translationNote = (language: Language): string => `Перевод с ${TRANSLATED_FROM[language]}`;

/** Текст для смены: перевод, пометка о нём и сам оригинал под ней. */
export const withOriginal = (text: string, original: OriginalText | undefined): string =>
  original ? `${text}\n\n${translationNote(original.language)}. Оригинал:\n${original.text}` : text;
