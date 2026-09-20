import type { Resident } from '@domovoy/app';
import { LANGUAGES, languageFrom, type Language } from '@domovoy/i18n';
import { Keyboard } from '@maxkit/max-bot-api';

import { screenOf } from './keyboards.js';
import { ROOT_MENUS, type BotContext } from './max.js';
import type { Extra, Handler, BotKit } from './kit.js';

/**
 * Вопрос о языке. Он не переводится: его читает человек, который ещё не выбрал
 * язык, и по-русски может не читать вовсе. Строки идут на самых частых языках.
 */
export const LANGUAGE_QUESTION = [
  'Выберите язык',
  'Choose your language',
  'Tilni tanlang',
  'Тілді таңдаңыз',
].join('\n');

/** Язык клиента: платформа присылает его в апдейте рядом с отправителем. */
export const localeLanguage = (typed: BotContext): Language | undefined =>
  languageFrom((typed.update as { user_locale?: string | null }).user_locale);

/** Языки списком: язык клиента первым, остальные в порядке продукта. */
const ordered = (preferred?: Language): readonly { code: Language; title: string }[] => {
  const all = LANGUAGES.map((language) => ({ code: language.code, title: language.title }));
  const first = preferred ? all.filter((language) => language.code === preferred) : [];

  return [...first, ...all.filter((language) => language.code !== preferred)];
};

/** Языки кнопками по две в ряд, выбранный помечен. */
export const languageKeyboard = (resident?: Resident, preferred?: Language): Extra => {
  const buttons = ordered(preferred).map((language) =>
    Keyboard.button.callback(
      `${language.code === resident?.language ? '✅ ' : ''}${language.title}`,
      `lang:${language.code}`,
    ),
  );

  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];

  for (let at = 0; at < buttons.length; at += 2) rows.push(buttons.slice(at, at + 2));

  const built = screenOf({ attachments: [Keyboard.inlineKeyboard(rows)] });

  // Выходов под списком нет: до выбора языка «Назад» и «Меню» человеку нечего
  // сказать, а после выбора он и так попадает в меню.
  ROOT_MENUS.add(built);

  return built;
};

/** Вопрос о языке со списком. */
export const askLanguage = async (typed: BotContext, resident?: Resident): Promise<void> => {
  await typed.reply(LANGUAGE_QUESTION, languageKeyboard(resident, localeLanguage(typed)));
};

/** Смена языка отдельной командой: тот же список, что и при первом разговоре. */
export const languageCommands = (kit: BotKit): Record<string, Handler> => ({
  lang: async (typed) => {
    await askLanguage(typed, await kit.residentOf(typed));
  },
});
