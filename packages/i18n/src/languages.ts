/**
 * Языки продукта. Названия написаны на самом языке: человек, который не читает
 * по-русски, находит свой язык в списке глазами, а не по подсказке.
 */
export const LANGUAGES = [
  { code: 'ru', title: 'Русский' },
  { code: 'en', title: 'English' },
  { code: 'tt', title: 'Татарча' },
  { code: 'uz', title: 'Oʻzbekcha' },
  { code: 'tg', title: 'Тоҷикӣ' },
  { code: 'ky', title: 'Кыргызча' },
  { code: 'kk', title: 'Қазақша' },
  { code: 'az', title: 'Azərbaycanca' },
  { code: 'hy', title: 'Հայերեն' },
  { code: 'tk', title: 'Türkmençe' },
  { code: 'ka', title: 'ქართული' },
  { code: 'ro', title: 'Română' },
  { code: 'zh', title: '中文' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

/** Язык, на котором продукт написан: с него переводят и к нему возвращаются. */
export const DEFAULT_LANGUAGE: Language = 'ru';

const CODES: readonly string[] = LANGUAGES.map((language) => language.code);

export const isLanguage = (code: string): code is Language => CODES.includes(code);

/** Письменность языка: по ней видно, на своём ли языке пришёл ответ модели. */
export type Script = 'cyrillic' | 'latin' | 'armenian' | 'georgian' | 'han';

const SCRIPTS: Readonly<Record<Language, Script>> = {
  ru: 'cyrillic',
  tt: 'cyrillic',
  tg: 'cyrillic',
  ky: 'cyrillic',
  kk: 'cyrillic',
  en: 'latin',
  uz: 'latin',
  az: 'latin',
  tk: 'latin',
  ro: 'latin',
  hy: 'armenian',
  ka: 'georgian',
  zh: 'han',
};

export const languageScript = (code: Language): Script => SCRIPTS[code];

/** Как язык называется на самом себе. */
export const languageTitle = (code: Language): string =>
  LANGUAGES.find((language) => language.code === code)?.title ?? code;

/**
 * Язык клиента приводится к нашему: платформа присылает «ru», «ru-RU», «uz-Latn».
 * Молдавский и румынский это один язык с разными названиями, поэтому «mo» ведёт
 * на «ro». Незнакомый код не подменяется русским молча: выбор остаётся за человеком.
 */
export const languageFrom = (locale: string | undefined | null): Language | undefined => {
  const code = locale?.trim().toLowerCase().split(/[-_]/u)[0];

  if (!code) return undefined;
  if (code === 'mo') return 'ro';
  if (code === 'tj') return 'tg';

  return isLanguage(code) ? code : undefined;
};
