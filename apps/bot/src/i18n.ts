import { speak as speakProduct, type Resident } from '@domovoy/app';
import { translatorFor, type Language, type Translate } from '@domovoy/i18n';

/** Области словаря, кроме своей: их ключи приходят с приставкой и не трогаются. */
const OTHER_AREAS = /^(app|when|miniapp)\./u;

/**
 * Строки бота лежат своей областью словаря, и снаружи у них приставка «bot.».
 * Внутри бота ключи пишутся без неё: приставку дописывает сам перевод.
 * Ключ чужой области приходит с приставкой и остаётся как есть.
 */
const scoped =
  (t: Translate): Translate =>
  (key, values) =>
    t(OTHER_AREAS.test(key) ? key : `bot.${key}`, values);

/** Перевод для человека: без выбранного языка продукт говорит по-русски. */
export const speak = (resident?: Resident): Translate => scoped(speakProduct(resident));

/** Перевод по языку, а не по человеку: в сессии от него остаётся только код. */
export const speakLanguage = (language: Language | undefined): Translate => scoped(translatorFor(language));

/**
 * Перевод там, где человек ещё не известен: подписи кнопок в уведомлениях и
 * экранах смены. Русский словарь и есть исходный текст продукта.
 */
export const RU: Translate = speak(undefined);
