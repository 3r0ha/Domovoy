import { answerAboutHouse, clarifyTarget, type Resident, type SubmitResult } from '@domovoy/app';
import { CATEGORY_RULES, STATUS_TITLES, describeTarget, emergencyHint, formatMoment } from '@domovoy/domain';
import { Keyboard, fmt } from '@maxkit/max-bot-api';

import { cancelKeyboard, whereKeyboard } from './keyboards.js';
import { expect, inChat, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Обращение откладывается до кнопки: жилец решит, нужна ли заявка. */
const remember = (typed: BotContext, description: string, startParam?: string): void => {
  typed.session ??= {};
  typed.session.plannedDescription = description;
  if (startParam) typed.session.plannedTarget = startParam;
};

/** Вопрос о доме получает ответ вместо заявки. */
export const answerQuestion = async (
  kit: BotKit,
  typed: BotContext,
  resident: Resident,
  description: string,
  startParam?: string,
): Promise<boolean> => {
  const answer = await answerAboutHouse(kit.deps, resident, description).catch(() => ({ text: undefined }));

  if (!answer.text) return false;

  remember(typed, description, startParam);

  await typed.reply(answer.text, Keyboard.inlineKeyboard([[Keyboard.button.callback('✍️ Оформить заявку', 'anyway')]]));

  return true;
};

/**
 * Уточняющий вопрос об адресе: варианты приходят кнопками, а сами адреса
 * берутся из дома, поэтому нажатие всегда ведёт к настоящему объекту.
 */
const askWhere = async (kit: BotKit, typed: BotContext, created: { id: string }): Promise<boolean> => {
  const resident = await kit.residentOf(typed);
  const request = await kit.deps.repository.findRequest(created.id);

  if (!request) return false;

  const clarification = await clarifyTarget(kit.deps, resident, request).catch(() => undefined);

  if (!clarification) return false;

  typed.session ??= {};
  typed.session.where = { requestId: request.id, options: clarification.options };

  await typed.reply(clarification.question, whereKeyboard(request.id, clarification.options));

  return true;
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
      Keyboard.inlineKeyboard([[Keyboard.button.callback('✍️ Оформить заявку', 'anyway')]]),
    );
    return;
  }

  // Обращение оказалось вопросом: ответ уже есть, заявку заводит кнопка.
  if (result.kind === 'answered') {
    remember(typed, description, startParam);

    await typed.reply(
      result.answer,
      Keyboard.inlineKeyboard([[Keyboard.button.callback('✍️ Оформить заявку', 'anyway')]]),
    );
    return;
  }

  const created = result.request;
  const rule = CATEGORY_RULES[created.category];

  if (result.kind === 'joined') {
    await typed.reply(
      `О такой проблеме уже сообщили: заявка ${fmt.bold(created.number)}, ` +
        `${STATUS_TITLES[created.status]}.\n` +
        `${rule.title}, ${describeTarget(created.target)}.\n` +
        `Вы ${result.reporters}-й, кто написал об этом. Срок выполнения: до ${formatMoment(created.resolutionDueAt)}.\n` +
        'Об изменениях сообщу вам так же, как автору.',
      kit.openApp(startParam, typed),
    );
    return;
  }

  const hint = emergencyHint(created.category, created.priority);

  await typed.reply(
    `Заявка ${fmt.bold(created.number)} принята.\n` +
      `${rule.title}, ${describeTarget(created.target)}.\n` +
      `Ответим до ${formatMoment(created.reactionDueAt)}.\n` +
      `Срок выполнения: до ${formatMoment(created.resolutionDueAt)}.` +
      (hint ? `\n\n${hint}` : ''),
    kit.openApp(startParam, typed),
  );

  if (inChat(typed)) return;

  // Где случилось, спрашивается кнопками: набирать адрес руками пожилому человеку тяжело.
  if (await askWhere(kit, typed, created)) return;

  // Нерасшифрованное голосовое спрашивают первым: без него в заявке нет сути.
  const ask = unheard ? 'Голосовое не разобрал. Напишите одной строкой, что случилось.' : result.question;

  if (!ask) return;

  typed.session ??= {};
  expect(typed, { kind: 'message', requestId: created.id });

  await typed.reply(`${ask}\nМожно не отвечать, заявка уже в работе.`, cancelKeyboard());
};
