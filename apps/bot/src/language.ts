import type { Resident } from '@domovoy/app';
import { LANGUAGES, languageFrom, translatorFor, type Language } from '@domovoy/i18n';
import { Keyboard } from '@maxkit/max-bot-api';

import { screenOf } from './keyboards.js';
import { ROOT_MENUS, type BotContext } from './max.js';
import type { Extra, Handler, BotKit } from './kit.js';

/**
 * Вопрос о языке. Он не переводится: его читает человек, который ещё не выбрал
 * язык, и по-русски может не читать вовсе. Строки идут на самых частых языках.
 */
/**
 * Вопрос о языке: по-русски, по-английски и на языке клиента MAX, если он
 * известен и это третий язык. Человек, который языка ещё не выбирал, должен
 * прочитать вопрос хоть на одной из строк.
 */
export const languageQuestion = (language?: Language): string => {
  const asks = (code: Language): string => translatorFor(code)('app.lang.ask');
  const lines = [asks('ru'), asks('en')];
  const own = language ? asks(language) : undefined;

  return (own && !lines.includes(own) ? [...lines, own] : lines).join('\n');
};

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
  const spoken = localeLanguage(typed);

  await typed.reply(languageQuestion(spoken), languageKeyboard(resident, spoken));
};

/** Смена языка отдельной командой: тот же список, что и при первом разговоре. */
export const languageCommands = (kit: BotKit): Record<string, Handler> => ({
  lang: async (typed) => {
    const resident = await kit.residentOf(typed);

    // Смена и подрядчик работают по-русски: очередь, наряды и сводка одни на всех.
    if (resident.role !== 'resident') {
      await typed.reply('Смена работает на русском языке. Язык выбирают жильцы.', kit.menuKeyboard(resident));
      return;
    }

    await askLanguage(typed, resident);
  },
});
