import { acceptLegal, legalAccepted, type Resident } from '@domovoy/app';
import { legalDocuments } from '@domovoy/domain';
import { DEFAULT_LANGUAGE, legalLanguage, type Language } from '@domovoy/i18n';
import { Keyboard } from '@maxkit/max-bot-api';

import { speak } from '../i18n.js';
import { needsFlat } from '../apartment.js';
import { appRow, keyboardOf } from '../keyboards.js';
import { ROOT_MENUS, type BotContext } from '../max.js';
import type { BotKit, Handler } from '../kit.js';

/** Сайт по умолчанию: там же, где лежит лендинг продукта. */
const SITE = 'https://domovoy.homes';

/**
 * Ссылка на документ: сайт открывается в браузере, приложение показывает его
 * внутри. Язык человека ведёт на свою страницу, русская редакция лежит в корне.
 */
const linkTo = (kit: BotKit, slug: string, language: Language): string => {
  const site = kit.siteUrl ?? SITE;

  return language === DEFAULT_LANGUAGE ? `${site}/${slug}/` : `${site}/${language}/${slug}/`;
};

/** Документы кнопками: полные тексты в переписку не уходят. */
const documentRows = (kit: BotKit, resident: Resident) => {
  const language = legalLanguage(resident.language);

  return legalDocuments(language).map((document) => [
    Keyboard.button.link(document.short, linkTo(kit, document.slug, language)),
  ]);
};

/**
 * Согласие с документами до обработки данных. Политику обработки персональных
 * данных оператор публикует и открывает для чтения (ч. 2 ст. 18.1 152-ФЗ),
 * поэтому она приходит ссылкой на сайт и текстом в переписку.
 */
export const askLegal = async (kit: BotKit, typed: BotContext): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  // Экран согласия остаётся сам по себе: с «Назад» и «Меню» человек уходил
  // в меню, выбирал дело и упирался в те же документы новой копией сообщения.
  const screen = keyboardOf(
    [[Keyboard.button.callback(t('button.accept_legal'), 'legal:accept')], ...documentRows(kit, resident)],
    typed,
    t,
  );

  if (screen) ROOT_MENUS.add(screen);

  await typed.reply(t('legal.ask'), screen);
};

/**
 * Нужно ли сначала спросить согласие: без него продукт ничего не сохраняет.
 * То, о чём человек просил, запоминается и делается сразу после согласия:
 * иначе за документами теряется само дело.
 */
export const needsLegal = async (kit: BotKit, typed: BotContext, command?: string): Promise<boolean> => {
  const resident = await kit.residentOf(typed);

  if (legalAccepted(resident)) return false;

  typed.session ??= {};
  if (command) typed.session.afterLegal = command;

  await askLegal(kit, typed);

  return true;
};

/** Документы кнопками, а не текстом: целиком они читаются в приложении и на сайте. */
export const legalCommands = (kit: BotKit): Record<string, Handler> => ({
  legal: async (typed) => {
    const resident = await kit.residentOf(typed);

    if (!legalAccepted(resident)) {
      await askLegal(kit, typed);
      return;
    }

    const t = speak(resident);

    await typed.reply(
      t('legal.accepted'),
      keyboardOf(
        [...documentRows(kit, resident), ...appRow(kit.miniAppUrl, t('button.legal_in_app'), 'profile', t)],
        typed,
        t,
      ),
    );
  },
});

/** Нажатие «Принимаю»: согласие сохраняется и разговор продолжается с того же места. */
export const takeLegal = async (kit: BotKit, typed: BotContext): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const saved = await acceptLegal(kit.deps, resident);
  const asked = typed.session?.afterLegal;

  delete typed.session?.afterLegal;

  if (asked && (await kit.run(asked, typed))) return;

  // Жилец без квартиры после согласия получает одно сообщение: просьбу о коде.
  if (await needsFlat(kit, typed)) return;

  await typed.reply(speak(saved)('legal.thanks'), kit.menuKeyboard(saved));
};
