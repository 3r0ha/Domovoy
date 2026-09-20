import { DEFAULT_LANGUAGE, type Language } from './languages.js';

/** Словарь одного языка: ключ и строка с подстановками вида `{номер}`. */
export type Dictionary = Readonly<Record<string, string>>;

export type Values = Readonly<Record<string, string | number>>;

/** Перевод строки по ключу. Значения подставляются в фигурные скобки. */
export type Translate = (key: string, values?: Values) => string;

/** Имя подстановки бывает и русским: `\w` в JS знает только латиницу. */
const PLACEHOLDER = /\{([\p{L}\d_]+)\}/gu;

export const fill = (text: string, values: Values | undefined): string =>
  values ? text.replace(PLACEHOLDER, (whole, name: string) => String(values[name] ?? whole)) : text;

export interface TranslatorOptions {
  /** Словари по языкам. Русский обязателен: на него опирается запасной путь. */
  dictionaries: Readonly<Partial<Record<Language, Dictionary>>> & { ru: Dictionary };
  /** Что делать с ключом, которого нет нигде. По умолчанию возвращается сам ключ. */
  onMissing?: (key: string, language: Language) => void;
}

/**
 * Переводчик на один язык. Непереведённая строка берётся из русского словаря:
 * человек увидит её по-русски, но увидит, а не пустое место или ключ.
 */
export const translator = (language: Language, options: TranslatorOptions): Translate => {
  const own = options.dictionaries[language] ?? options.dictionaries.ru;
  const fallback = options.dictionaries.ru;

  return (key, values) => {
    const text = own[key] ?? fallback[key];

    if (text === undefined) {
      options.onMissing?.(key, language);

      return key;
    }

    return fill(text, values);
  };
};

/** Переводчик на язык по умолчанию: нужен там, где человек ещё неизвестен. */
export const defaultTranslator = (options: TranslatorOptions): Translate =>
  translator(DEFAULT_LANGUAGE, options);
