import { acceptLegal, legalAccepted } from '@domovoy/app';
import { LEGAL_DOCUMENTS } from '@domovoy/domain';
import { Keyboard } from '@maxkit/max-bot-api';

import { appRow, keyboardOf } from '../keyboards.js';
import { ROOT_MENUS, type BotContext } from '../max.js';
import type { BotKit, Handler } from '../kit.js';

/** Сайт по умолчанию: там же, где лежит лендинг продукта. */
const SITE = 'https://domovoy.homes';

/** Ссылка на документ: сайт открывается в браузере, приложение показывает его внутри. */
const linkTo = (kit: BotKit, slug: string): string => `${kit.siteUrl ?? SITE}/${slug}/`;

/** Документы кнопками: полные тексты в переписку не уходят. */
const documentRows = (kit: BotKit) =>
  LEGAL_DOCUMENTS.map((document) => [Keyboard.button.link(document.short, linkTo(kit, document.slug))]);

/**
 * Согласие с документами до обработки данных. Политику обработки персональных
 * данных оператор публикует и открывает для чтения (ч. 2 ст. 18.1 152-ФЗ),
 * поэтому она приходит ссылкой на сайт и текстом в переписку.
 */
export const askLegal = async (kit: BotKit, typed: BotContext): Promise<void> => {
  // Телефон аварийной службы стоит рядом с просьбой: авария не ждёт согласия.
  const resident = await kit.residentOf(typed);
  const house = await kit.deps.repository.findBuilding(resident.buildingId ?? kit.deps.defaultBuildingId);
  const emergency = house?.service?.emergencyPhone ?? house?.service?.phone;
  const urgent = emergency ? `\nАварийная служба круглосуточно: ${emergency}.` : '';

  // Экран согласия остаётся сам по себе: с «Назад» и «Меню» человек уходил
  // в меню, выбирал дело и упирался в те же документы новой копией сообщения.
  const screen = keyboardOf(
    [[Keyboard.button.callback('✅ Принимаю', 'legal:accept')], ...documentRows(kit)],
    typed,
  );

  if (screen) ROOT_MENUS.add(screen);

  await typed.reply(
    'Домовой обрабатывает персональные данные по поручению управляющей организации дома.\n' +
      'Политика обработки и пользовательское соглашение, по кнопкам ниже.\n' +
      `Нажимая «Принимаю», вы соглашаетесь с ними. Без согласия я не смогу принять заявку ` +
      `и сохранить показания.${urgent}`,
    screen,
  );
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

    await typed.reply(
      'Вы согласились с действующей редакцией.\nПолные тексты открываются по кнопкам.',
      keyboardOf([...documentRows(kit), ...appRow(kit.miniAppUrl, 'Документы в приложении', 'profile')], typed),
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

  await typed.reply('Спасибо. Чем помочь?', kit.menuKeyboard(saved));
};
