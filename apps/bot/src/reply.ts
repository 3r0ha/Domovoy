import {
  answerAboutHouse,
  clarifyTarget,
  languageOf,
  languageOfText,
  translateForReading,
  zoneOf,
  type Resident,
  type SubmitResult,
} from '@domovoy/app';
import { categoryKey, describeTarget, emergencyHint, formatMoment, statusTitle, targetName } from '@domovoy/domain';
import { languageTitle, translatorFor, type Translate } from '@domovoy/i18n';
import { Keyboard } from '@maxkit/max-bot-api';

import { speak } from './i18n.js';
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
    speak(resident),
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
  bill: { title: 'topic.bill', command: 'bill' },
  request: { title: 'topic.request', command: 'my' },
  works: { title: 'topic.news', command: 'news' },
  incident: { title: 'topic.news', command: 'news' },
};

/** Кнопка «Оформить заявку» под ответом, который заявкой не стал. */
const anywayRow = (t: Translate) => [Keyboard.button.callback(t('button.new_request'), 'anyway')];

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

  const t = speak(resident);

  // К ответу даётся сам раздел: назвать его словами и не дать кнопку значит
  // оставить человека искать её руками по меню.
  const to = TOPIC_SECTIONS[answer.topic];

  // Квитанция и свои заявки при соседях не читаются: в чат уходит строка,
  // а сам ответ в личную переписку.
  const personal = inChat(typed) && PERSONAL_TOPICS.has(answer.topic);

  if (personal && (await answerPrivately(kit, typed, resident, answer.text, to && { ...to, title: t(to.title) })))
    return true;

  remember(typed, description, startParam);

  await typed.reply(answer.text, {
    attachments: [
      Keyboard.inlineKeyboard([
        ...(to ? [[Keyboard.button.callback(t(to.title), `menu:${to.command}`)]] : []),
        ...languageRow(resident, description),
        anywayRow(t),
      ]),
    ],
  });

  return true;
};

/**
 * Вопрос задан на другом языке: под ответом стоит переход на него. Ответ
 * человеку нужен сразу, а язык он выберет заодно, не ища раздел руками.
 */
const languageRow = (resident: Resident, said: string) => {
  const heard = languageOfText(said);

  if (!heard || heard === languageOf(resident)) return [];

  const voice = translatorFor(heard);

  return [
    [
      Keyboard.button.callback(
        voice('app.assistant.languageButton', { язык: languageTitle(heard) }),
        `lang:${heard}`,
      ),
    ],
  ];
};

/**
 * Уточняющий вопрос об адресе: варианты приходят кнопками, а сами адреса
 * берутся из дома, поэтому нажатие всегда ведёт к настоящему объекту.
 */
const askWhere = async (
  kit: BotKit,
  typed: BotContext,
  created: { id: string },
  t: Translate,
): Promise<{ question: string; keyboard: ReturnType<typeof whereKeyboard> } | undefined> => {
  const resident = await kit.residentOf(typed);
  const request = await kit.deps.repository.findRequest(created.id);

  if (!request) return undefined;

  const clarification = await clarifyTarget(kit.deps, resident, request).catch(() => undefined);

  if (!clarification) return undefined;

  typed.session ??= {};
  typed.session.where = { requestId: request.id, options: clarification.options };

  return { question: clarification.question, keyboard: whereKeyboard(request.id, clarification.options, t) };
};

/** Где случилось: название оборудования на языке того, кто читает. */
const placeOf = async (
  kit: BotKit,
  resident: Resident,
  request: { target: Parameters<typeof describeTarget>[0] },
  t: Translate,
): Promise<string> => {
  const machine = await translateForReading(kit.deps, resident, [targetName(request.target)]);

  return machine.of(describeTarget(request.target, undefined, t));
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
  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  if (result.kind === 'planned') {
    remember(typed, description, startParam);

    await typed.reply(`${result.explanation}\n${t('request.planned')}`, {
      attachments: [Keyboard.inlineKeyboard([anywayRow(t)])],
    });
    return;
  }

  // Обращение оказалось вопросом: ответ уже есть, заявку заводит кнопка.
  if (result.kind === 'answered') {
    // При соседях подсказка по разделу уходит лично: раздел у каждого свой.
    if (inChat(typed)) {
      const command = result.command?.replace(/^\//, '');
      const item = command ? itemFor(resident, command) : undefined;
      const section = item && command ? { title: t(item.title), command } : undefined;

      if (await answerPrivately(kit, typed, resident, result.answer, section)) return;
    }

    remember(typed, description, startParam);

    await typed.reply(result.answer, { attachments: [Keyboard.inlineKeyboard([anywayRow(t)])] });
    return;
  }

  const created = result.request;

  // Сроки показываются по времени дома: в карточке заявки они уже так и
  // печатаются, и два разных времени у одного срока человека сбивают.
  const zone = await zoneOf(kit.deps, created.buildingId);
  // Оборудование названо в справочнике дома по-русски: жильцу с другим языком
  // название переводит служба, подъезд и номер квартиры берутся из словаря.
  const place = await placeOf(kit, resident, created, t);

  if (result.kind === 'joined') {
    await typed.reply(
      `${t('request.joined', { номер: created.number, состояние: statusTitle(created.status, false, t) })}\n` +
        `${t('request.what', { что: t(categoryKey(created.category)), где: place })}\n` +
        `${t('request.joined_you', {
          который: result.reporters,
          срок: formatMoment(created.resolutionDueAt, zone, t),
        })}\n` +
        t('request.notify'),
      kit.openApp(startParam, typed),
    );
    return;
  }

  const hint = emergencyHint(created.category, created.priority, t);

  // Повтор того же текста: человек не понимает, завелись ли три заявки.
  if (result.again) {
    await typed.reply(
      `${t('request.same', { номер: strong(created.number) })}\n` +
        `${t('request.what', { что: t(categoryKey(created.category)), где: plain(place) })}\n` +
        t('request.fix', { срок: strong(formatMoment(created.resolutionDueAt, zone, t)) }),
      kit.openApp(startParam, typed),
    );

    return;
  }

  const receipt =
    `${t('request.accepted', { номер: strong(created.number) })}\n` +
    `${t('request.what', {
      что: t(categoryKey(created.category)).toLowerCase(),
      где: plain(place),
    })}\n` +
    `${t('request.react', { срок: formatMoment(created.reactionDueAt, zone, t) })}\n` +
    t('request.fix', { срок: strong(formatMoment(created.resolutionDueAt, zone, t)) }) +
    (hint ? `\n\n${hint}` : '');

  // Где случилось, спрашивается кнопками: набирать адрес руками пожилому человеку
  // тяжело. Вопрос идёт тем же сообщением, что и чек: отдельным он приходил после
  // срока выполнения и выглядел как новый разговор.
  const where = inChat(typed) ? undefined : await askWhere(kit, typed, created, t);

  if (where) {
    await typed.reply(`${receipt}\n\n${where.question}`, where.keyboard);
    return;
  }

  await typed.reply(receipt, kit.openApp(startParam, typed));

  if (inChat(typed)) return;

  // Нерасшифрованное голосовое спрашивают первым: без него в заявке нет сути.
  const ask = unheard ? t('voice.unheard') : result.question;

  if (!ask) return;

  typed.session ??= {};
  expect(typed, { kind: 'message', requestId: created.id });

  // «Уже в работе» обещает больше, чем есть: заявка только принята.
  await typed.reply(`${ask}\n${t('request.optional')}`, cancelKeyboard(t));
};
