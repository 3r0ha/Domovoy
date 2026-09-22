import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { DEFAULT_LANGUAGE, isLanguage, translatorFor, type Language, type Translate } from '@domovoy/i18n';

/** Язык человека и перевод на него. */
export interface I18n {
  language: Language;
  t: Translate;
}

/** Область словаря: ключи мини-приложения лежат под своей приставкой. */
const AREA = 'miniapp';

/** Перевод по ключу без приставки: её добавляет сама область. */
const scoped = (translate: Translate): Translate => (key, values) => translate(`${AREA}.${key}`, values);

/** Где помнится выбранный язык: профиль приходит с сервера, а войти нужно уже на нём. */
const CHOICE_KEY = 'domovoy.language';

/**
 * Язык прошлого запуска. Экран входа рисуется до того, как придёт профиль,
 * и без этой памяти «Входим…» каждый раз здоровается по-русски.
 */
const remembered = (): Language | undefined => {
  try {
    const code = globalThis.localStorage.getItem(CHOICE_KEY);

    return code && isLanguage(code) ? code : undefined;
  } catch {
    return undefined;
  }
};

const remember = (language: Language): void => {
  try {
    globalThis.localStorage.setItem(CHOICE_KEY, language);
  } catch {
    // Хранилище закрыто настройками браузера: язык просто не переживёт перезапуск.
  }
};

const initial: I18n = { language: DEFAULT_LANGUAGE, t: scoped(translatorFor(undefined)) };

const I18nContext = createContext<I18n>(initial);

/** Перевод вне React: клиент API собирает сообщения об отказах сам. */
let active: Translate = initial.t;

/** Тот же язык вне React: по нему считаются формы слов, даты и числа. */
let spoken: Language = DEFAULT_LANGUAGE;

export const say: Translate = (key, values) => active(key, values);

/** Язык, на котором сейчас говорит приложение. */
export const spokenLanguage = (): Language => spoken;

export interface I18nProviderProps {
  /** Язык из профиля. Пусто: человек его ещё не выбирал. */
  language?: Language | null;
  children: ReactNode;
}

/** Язык рабочей области: под ним живут все экраны. */
export const I18nProvider = ({ language, children }: I18nProviderProps) => {
  const value = useMemo<I18n>(() => {
    const chosen = language ?? remembered() ?? DEFAULT_LANGUAGE;

    if (language) remember(language);

    return { language: chosen, t: scoped(translatorFor(chosen)) };
  }, [language]);

  // Перевод вне React берёт тот же язык: клиент API живёт рядом с деревом, а не в нём.
  active = value.t;
  spoken = value.language;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

/** Перевод строки на язык человека. */
export const useT = (): Translate => useContext(I18nContext).t;

/** Язык, на котором человек сейчас читает приложение. */
export const useLanguage = (): Language => useContext(I18nContext).language;
