import { answerAboutHouse, clarifyTarget, zoneOf, type Resident, type SubmitResult } from '@domovoy/app';
import { CATEGORY_RULES, STATUS_TITLES, describeTarget, emergencyHint, formatMoment } from '@domovoy/domain';
import { Keyboard } from '@maxkit/max-bot-api';

import { cancelKeyboard, keyboardOf, PERSONAL, whereKeyboard } from './keyboards.js';
import { itemFor } from './menu.js';
import { expect, inChat, plain, shown, strong, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/**
 * Ответ при соседях уходит в личную переписку вместе с кнопкой раздела, а в
 * чате остаётся строка о том, что ответ был: квитанция, свои заявки и подсказка
 * по разделу читаются только тем, кто спросил.
 */
const answerPrivately = async (
  kit: BotKit,
  typed: BotContext,
  resident: Resident,
  text: string,
  section?: { title: string; command: string },
): Promise<boolean> => {
  if (resident.maxUserId === undefined) return false;

  const keyboard = keyboardOf(
    section ? [[Keyboard.button.callback(section.title, `menu:${section.command}`)]] : [],
    PERSONAL,
  );
  const ready = shown(text, keyboard);

  await kit.bot.api.sendMessageToUser(resident.maxUserId, ready.text, ready.extra).catch(() => undefined);
  await typed.reply(`${resident.displayName}, ответил вам лично.`);

  return true;
};

/** Обращение откладывается до кнопки: жилец решит, нужна ли заявка. */
const remember = (typed: BotContext, description: string, startParam?: string): void => {
  typed.session ??= {};
  typed.session.plannedDescription = description;
  if (startParam) typed.session.plannedTarget = startParam;
};

/** Вопрос о доме получает ответ вместо заявки. */
/** О чём ответ: про дом целиком или про самого спрашивающего. */
const PERSONAL_TOPICS = new Set(['bill', 'request']);

/** Где продолжается ответ: раздел бота под тему вопроса. */
const TOPIC_SECTIONS: Record<string, { title: string; command: string }> = {
  bill: { title: '🧾 Квитанция за месяц', command: 'bill' },
  request: { title: '📋 Заявки', command: 'my' },
  works: { title: '📣 Объявления', command: 'news' },
  incident: { title: '📣 Объявления', command: 'news' },
};

export const answerQuestion = async (
  kit: BotKit,
  typed: BotContext,
  resident: Resident,
  description: string,
  startParam?: string,
): Promise<boolean> => {
  const answer = await answerAboutHouse(kit.deps, resident, description).catch(() => ({
    text: undefined,
    topic: 'unknown' as const,
  }));

  if (!answer.text) return false;

  // К ответу даётся сам раздел: назвать его словами и не дать кнопку значит
  // оставить человека искать её руками по меню.
  const to = TOPIC_SECTIONS[answer.topic];

  // Квитанция и свои заявки при соседях не читаются: в чат уходит строка,
  // а сам ответ в личную переписку.
  const personal = inChat(typed) && PERSONAL_TOPICS.has(answer.topic);

  if (personal && (await answerPrivately(kit, typed, resident, answer.text, to))) return true;

  remember(typed, description, startParam);

  await typed.reply(answer.text, {
    attachments: [
      Keyboard.inlineKeyboard([
        ...(to ? [[Keyboard.button.callback(to.title, `menu:${to.command}`)]] : []),
        [Keyboard.button.callback('✍️ Оформить заявку', 'anyway')],
      ]),
    ],
  });

  return true;
};

/**
 * Уточняющий вопрос об адресе: варианты приходят кнопками, а сами адреса
 * берутся из дома, поэтому нажатие всегда ведёт к настоящему объекту.
 */
const askWhere = async (
  kit: BotKit,
  typed: BotContext,
  created: { id: string },
): Promise<{ question: string; keyboard: ReturnType<typeof whereKeyboard> } | undefined> => {
  const resident = await kit.residentOf(typed);
  const request = await kit.deps.repository.findRequest(created.id);

  if (!request) return undefined;

  const clarification = await clarifyTarget(kit.deps, resident, request).catch(() => undefined);

  if (!clarification) return undefined;

  typed.session ??= {};
  typed.session.where = { requestId: request.id, options: clarification.options };

  return { question: clarification.question, keyboard: whereKeyboard(request.id, clarification.options) };
};

/** Что жилец узнаёт в ответ на своё обращение. */
export const announce = async (
  kit: BotKit,
  typed: BotContext,
  result: SubmitResult,
  description: string,
  startParam?: string,
  unheard?: boolean,
): Promise<void> => {
  if (result.kind === 'planned') {
    remember(typed, description, startParam);

    await typed.reply(
      `${result.explanation}\nЗаявка не нужна, если дело в этих работах.`,
      { attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback('✍️ Оформить заявку', 'anyway')]])] },
    );
    return;
  }

  // Обращение оказалось вопросом: ответ уже есть, заявку заводит кнопка.
  if (result.kind === 'answered') {
    // При соседях подсказка по разделу уходит лично: раздел у каждого свой.
    if (inChat(typed)) {
      const resident = await kit.residentOf(typed);
      const command = result.command?.replace(/^\//, '');
      const item = command ? itemFor(resident, command) : undefined;
      const section = item && command ? { title: item.title, command } : undefined;

      if (await answerPrivately(kit, typed, resident, result.answer, section)) return;
    }

    remember(typed, description, startParam);

    await typed.reply(
      result.answer,
      { attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback('✍️ Оформить заявку', 'anyway')]])] },
    );
    return;
  }

  const created = result.request;
  const rule = CATEGORY_RULES[created.category];

  // Сроки показываются по времени дома: в карточке заявки они уже так и
  // печатаются, и два разных времени у одного срока человека сбивают.
  const zone = await zoneOf(kit.deps, created.buildingId);

  if (result.kind === 'joined') {
    await typed.reply(
      `О такой проблеме уже сообщили: заявка ${created.number}, ` +
        `${STATUS_TITLES[created.status]}.\n` +
        `${rule.title}, ${describeTarget(created.target)}.\n` +
        `Вы ${result.reporters}-й, кто написал об этом. Починят до ${formatMoment(created.resolutionDueAt, zone)}.\n` +
        'Об изменениях сообщу вам так же, как автору.',
      kit.openApp(startParam, typed),
    );
    return;
  }

  const hint = emergencyHint(created.category, created.priority);

  // Повтор того же текста: человек не понимает, завелись ли три заявки.
  if (result.again) {
    await typed.reply(
      `Это та же заявка ${strong(created.number)}, новую не завожу.\n` +
        `${rule.title}, ${plain(describeTarget(created.target))}.\n` +
        `Починят до ${strong(formatMoment(created.resolutionDueAt, zone))}.`,
      kit.openApp(startParam, typed),
    );

    return;
  }

  const receipt =
    `Заявка ${strong(created.number)} принята. Номер пригодится, если будете звонить.\n` +
    `Что: ${rule.title.toLowerCase()}, ${plain(describeTarget(created.target))}.\n` +
    `Ответим до ${formatMoment(created.reactionDueAt, zone)}.\n` +
    `Починят до ${strong(formatMoment(created.resolutionDueAt, zone))}.` +
    (hint ? `\n\n${hint}` : '');

  // Где случилось, спрашивается кнопками: набирать адрес руками пожилому человеку
  // тяжело. Вопрос идёт тем же сообщением, что и чек: отдельным он приходил после
  // срока выполнения и выглядел как новый разговор.
  const where = inChat(typed) ? undefined : await askWhere(kit, typed, created);

  if (where) {
    await typed.reply(`${receipt}\n\n${where.question}`, where.keyboard);
    return;
  }

  await typed.reply(receipt, kit.openApp(startParam, typed));

  if (inChat(typed)) return;

  // Нерасшифрованное голосовое спрашивают первым: без него в заявке нет сути.
  const ask = unheard ? 'Голосовое не разобрал. Напишите одной строкой, что случилось.' : result.question;

  if (!ask) return;

  typed.session ??= {};
  expect(typed, { kind: 'message', requestId: created.id });

  // «Уже в работе» обещает больше, чем есть: заявка только принята.
  await typed.reply(`${ask}\nМожно не отвечать, заявка уже принята.`, cancelKeyboard());
};
