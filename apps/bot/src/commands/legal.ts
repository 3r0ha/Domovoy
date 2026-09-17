import { acceptLegal, legalAccepted } from '@domovoy/app';
import { LEGAL_DOCUMENTS, LEGAL_NOTICE, formatLegal } from '@domovoy/domain';
import { Keyboard } from '@maxkit/max-bot-api';

import { keyboardOf } from '../keyboards.js';
import type { BotContext } from '../max.js';
import type { BotKit, Handler } from '../kit.js';

/** Сайт по умолчанию: там же, где лежит лендинг продукта. */
const SITE = 'https://domovoy.homes';

/** Ссылка на документ: сайт открывается в браузере, приложение показывает его внутри. */
const linkTo = (kit: BotKit, slug: string): string => `${kit.siteUrl ?? SITE}/${slug}/`;

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
  const urgent = emergency ? `\n\nАварийная служба круглосуточно: ${emergency}.` : '';

  await typed.reply(
    `${LEGAL_NOTICE}\n\nНажимая «Принимаю», вы соглашаетесь с ними.${urgent}`,
    keyboardOf(
      [
        [Keyboard.button.callback('✅ Принимаю', 'legal:accept')],
        ...LEGAL_DOCUMENTS.map((document) => [Keyboard.button.link(document.short, linkTo(kit, document.slug))]),
      ],
      typed,
    ),
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

/** Документы текстом в переписку и согласие одной кнопкой. */
export const legalCommands = (kit: BotKit): Record<string, Handler> => ({
  legal: async (typed) => {
    for (const document of LEGAL_DOCUMENTS) await typed.reply(formatLegal(document));

    const resident = await kit.residentOf(typed);

    if (legalAccepted(resident)) {
      await typed.reply('Вы согласились с действующей редакцией.', kit.menuKeyboard(resident));
      return;
    }

    await askLegal(kit, typed);
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
