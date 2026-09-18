import {
  actionsFor,
  answerSupport,
  askSupport,
  answerHandoff,
  bindApartment,
  commentRequest,
  describeFromAttachments,
  metersFor,
  submitProblem,
  submitReading,
  takeVisit,
  transitionRequest,
  unheardVoice,
  formatVisit,
  zoneOf,
} from '@domovoy/app';
import {
  APARTMENT_CODE_LENGTH,
  DomainError,
  isApartmentCode,
  isCompanyStaff,
  normalizeApartmentCode,
  requestNumberIn,
  METER_RULES,
  STATUS_TITLES,
  verificationState,
  type Attachment,
} from '@domovoy/domain';

import { sayBound } from './greeting.js';
import { menuTitle } from './buttons.js';
import { showRequestByNumber } from './pages.js';
import {
  actionKeyboard,
  afterError,
  cancelKeyboard,
  COMMENT_DONE,
  decimal,
  errorText,
  menuButton,
  readingKeyboard,
  readingPrompt,
  replyIfOpen,
  visitCancelKeyboard,
  visitKeyboard,
} from './keyboards.js';
import { answerFromAssistant } from './talk.js';
import { thinking } from './thinking.js';
import { freeHours } from './commands/visits.js';
import { expect, forget, isChatter, QUIT, type Awaiting, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Что пришло от человека: текст, снимки или и то и другое. */
export interface Said {
  text?: string | undefined;
  attachments: Attachment[];
}

/** Показание с фотографии табло: распознанное число жилец подтверждает сам. */
const readFromPhoto = async (kit: BotKit, typed: BotContext, meterId: string, said: Said): Promise<void> => {
  const photo = said.attachments.find((attachment) => attachment.kind === 'photo');
  const value = photo && kit.vision?.readUrl ? await kit.vision.readUrl(photo.token) : undefined;

  await typed.reply(
    value === undefined
      ? 'Показание с фотографии не читается. Отправьте его числом, например 123,456'
      : `С фотографии: ${decimal(value)}. Если верно, отправьте это число, иначе своё.`,
    readingKeyboard(meterId, false),
  );
};

/** Числа в отказе приходят с точкой, а в переписке они везде с запятой. */
const commas = (text: string): string => text.replace(/(\d)\.(\d)/g, '$1,$2');

/** Показание счётчика: за принятым сразу спрашивается следующий прибор. */
const takeReading = async (kit: BotKit, typed: BotContext, meterId: string, text: string): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const value = Number(text.replace(',', '.').replace(/\s/g, ''));

  if (!Number.isFinite(value)) {
    await typed.reply(
      'Не похоже на число. Отправьте показание цифрами, например 123,456',
      readingKeyboard(meterId, false),
    );
    return;
  }

  try {
    const result = await submitReading(kit.deps, { resident, meterId, value });

    // Ожидание снимается принятым показанием: на отказ его повторяют тем же вводом.
    forget(typed);

    const meters = await metersFor(kit.deps, resident);
    const meter = meters.find((state) => state.meter.id === meterId);
    const rule = meter ? METER_RULES[meter.meter.kind] : undefined;

    await typed.reply(
      `Принято: ${decimal(result.reading.value)}${rule ? ` ${rule.unit}` : ''}.` +
        (result.consumption > 0
          ? ` Расход за период: ${decimal(result.consumption)}${rule ? ` ${rule.unit}` : ''}.`
          : '') +
        // Предупреждение о расходе идёт этим же сообщением: отдельным оно
        // приходило раньше чека и читалось как отказ.
        (result.advice ? `\n\n${commas(result.advice)}` : ''),
    );

    const next = meters.find(
      (state) => !state.submittedThisMonth && verificationState(state.meter, kit.deps.now()) !== 'expired',
    );

    if (next) {
      const left = meters.filter(
        (state) => !state.submittedThisMonth && verificationState(state.meter, kit.deps.now()) !== 'expired',
      );

      expect(typed, { kind: 'reading', meterId: next.meter.id });
      await typed.reply(readingPrompt(next), readingKeyboard(next.meter.id, left.length > 1));
    }
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(`Показание не принято: ${commas(errorText(error))}`, afterError(error, typed));
  }
};

/**
 * Сказанного мало: вопрос повторяется тем же экраном, а ожидание остаётся.
 * Так человек дописывает ответ, а не начинает разговор заново.
 */
const askAgain = async (typed: BotContext, error: unknown, waiting: Awaiting): Promise<boolean> => {
  if (!(error instanceof DomainError) || error.code !== 'text_empty') return false;

  expect(typed, waiting);

  await typed.reply(errorText(error), cancelKeyboard());

  return true;
};

/** Ответ по заявке: он уходит тому, кого заявка касается. */
const sendMessage = async (kit: BotKit, typed: BotContext, requestId: string, said: Said): Promise<void> => {
  const author = await kit.residentOf(typed);
  forget(typed);

  try {
    const updated = await commentRequest(kit.deps, {
      resident: author,
      requestId,
      text: said.text ?? '',
      ...(said.attachments.length ? { attachments: said.attachments } : {}),
    });

    await typed.reply(
      `Передал по заявке ${updated.number}.`,
      actionKeyboard(actionsFor(updated, author), replyIfOpen(updated)),
    );
  } catch (error) {
    if (await askAgain(typed, error, { kind: 'message', requestId })) return;
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(`Не получилось: ${errorText(error)}`, afterError(error, typed));
  }
};

/** Причина перехода: её ждут отдельным сообщением. */
const explainTransition = async (
  kit: BotKit,
  typed: BotContext,
  waiting: Extract<Awaiting, { kind: 'comment' }>,
  text: string,
  said?: Said,
): Promise<void> => {
  const actor = await kit.residentOf(typed);
  forget(typed);

  // Отметка о выезде по наклейке доезжает вместе со сдачей работы: мастер
  // сканирует код на месте, а пишет о сделанном уже потом.
  const proved = typed.session?.proved;
  const onSite = proved?.requestId === waiting.requestId ? proved.code : undefined;

  try {
    const updated = await transitionRequest(kit.deps, {
      resident: actor,
      requestId: waiting.requestId,
      to: waiting.to as never,
      comment: text,
      ...(onSite ? { provedBy: onSite } : {}),
      ...(said?.attachments.length ? { attachments: said.attachments } : {}),
    });

    if (onSite) delete typed.session?.proved;

    // Жильцу, который вернул работу, мастеру, который сдал её, и смене, которая
    // отказала, нужны разные слова: у сдачи это отметка о работе, а не причина.
    const answer =
      actor.role === 'resident'
        ? `Заявка ${updated.number} снова в работе: передал ваши слова мастеру.`
        : `Заявка ${updated.number}: ${STATUS_TITLES[updated.status]}. ${
            COMMENT_DONE[waiting.to] ?? 'Причину увидит жилец.'
          }`;

    await typed.reply(answer, actionKeyboard(actionsFor(updated, actor), replyIfOpen(updated)));
  } catch (error) {
    if (await askAgain(typed, error, { kind: 'comment', requestId: waiting.requestId, to: waiting.to })) return;
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(`Не получилось: ${errorText(error)}`, afterError(error, typed));
  }
};

/** Описание проблемы: из него заводится заявка либо получается ответ по дому. */
const describeProblem = async (
  kit: BotKit,
  typed: BotContext,
  startParam: string | undefined,
  said: Said,
): Promise<void> => {
  const resident = await kit.residentOf(typed);

  // Разбор сообщения идёт через модель и занимает секунды: молчание в переписке
  // читается как «не дошло», поэтому на это время появляется отметка.
  const waiting = thinking(kit, typed);

  try {
    const { description, attachments } = await describeFromAttachments(said.text, said.attachments, kit.transcriber);

    // Пустое сообщение заявкой не становится: ожидание остаётся, вопрос повторяется.
    if (!said.text?.trim() && attachments.length === 0) {
      await typed.reply('Опишите словами, что случилось. Подойдут фото, голосовое и файл.', cancelKeyboard());
      return;
    }

    if (attachments.length === 0 && (await kit.answered(typed, resident, description, startParam))) {
      forget(typed);

      return;
    }

    const result = await submitProblem(kit.deps, {
      resident,
      description,
      ...(attachments.length ? { attachments } : {}),
      ...(startParam ? { startParam } : {}),
    });

    forget(typed);

    await kit.announce(typed, result, description, startParam, !said.text?.trim() && unheardVoice(attachments));
  } catch (error) {
    if (await askAgain(typed, error, { kind: 'description', ...(startParam ? { target: startParam } : {}) })) return;
    if (!(error instanceof DomainError)) throw error;

    await typed.reply(
      `${error.message}. Отсканируйте код на подъезде или откройте приложение, там можно выбрать адрес.`,
      kit.openApp(undefined, typed),
    );
  } finally {
    await waiting();
  }
};

/** Вопрос в управляющую компанию или реплика в открытом обращении. */
const askSupportFrom = async (
  kit: BotKit,
  typed: BotContext,
  ticketId: string | undefined,
  said: Said,
): Promise<void> => {
  const resident = await kit.residentOf(typed);
  forget(typed);

  // Вежливое «спасибо» после команды обращением не становится: иначе оно уйдёт всей смене.
  if (!ticketId && said.attachments.length === 0 && isChatter(said.text ?? '')) {
    await typed.reply(await menuTitle(kit, resident), kit.menuKeyboard(resident));
    return;
  }

  try {
    const ticket = isCompanyStaff(resident.role)
      ? ticketId
        ? await answerSupport(kit.deps, { staff: resident, ticketId, text: said.text ?? '' })
        : undefined
      : await askSupport(kit.deps, {
          resident,
          text: said.text ?? '',
          ...(ticketId ? { ticketId } : {}),
          ...(said.attachments.length ? { attachments: said.attachments } : {}),
        });

    if (!ticket) {
      await typed.reply('Выберите обращение кнопкой «Ответить» под вопросом жильца.', menuButton(typed));
      return;
    }

    await typed.reply(
      isCompanyStaff(resident.role)
        ? `Ответ отправлен жильцу по обращению «${ticket.subject}».`
        : ticketId
          ? 'Передал в управляющую организацию. Ответ придёт сюда.'
          : `Вопрос принят: «${ticket.subject}». Ответ придёт сюда.`,
    );
  } catch (error) {
    if (await askAgain(typed, error, { kind: 'support', ...(ticketId ? { ticketId } : {}) })) return;
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(`Не получилось: ${errorText(error)}`, afterError(error, typed));
  }
};

/** Показание приходит числом, а без числа, снимком табло. */
const continueReading = async (kit: BotKit, typed: BotContext, meterId: string, said: Said): Promise<void> => {
  if (said.text) return takeReading(kit, typed, meterId, said.text);

  // Молчать нельзя: жилец ждёт ответа на присланное, чем бы оно ни было.
  await readFromPhoto(kit, typed, meterId, said);
};

/**
 * Сообщение, которого бот не ждал. В переписке человек просто рассказывает, что
 * случилось, поэтому такое сообщение становится обращением, а короткая вежливость
 * получает меню, а не заявку.
 */
/** Привязка по коду из квитанции, набранному сообщением. */
const bindByCode = async (kit: BotKit, typed: BotContext, code: string): Promise<void> => {
  const resident = await kit.residentOf(typed);

  try {
    const bound = await bindApartment(kit.deps, resident, code);

    forget(typed);

    await sayBound(kit, typed, bound);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;

    await typed.reply(errorText(error), afterError(error, typed));
  }
};

/** Код квартиры ждут отдельно: пока он не подошёл, ответ остаётся о коде. */
const takeCode = async (kit: BotKit, typed: BotContext, text: string): Promise<void> => {
  const code = normalizeApartmentCode(text);

  if (!isApartmentCode(code)) {
    // Знаков может быть ровно восемь, а не подойти буква: в коде нет тех,
    // которые путают с цифрами, и про это надо сказать отдельно.
    await typed.reply(
      code.length === APARTMENT_CODE_LENGTH
        ? 'В коде есть лишний знак. Похожие на цифры буквы в нём не используются, проверьте код в квитанции.'
        : `Код не подошёл: в нём ${APARTMENT_CODE_LENGTH} знаков, а вы набрали ${code.length}.`,
      cancelKeyboard(),
    );

    return;
  }

  await bindByCode(kit, typed, code);
};

const heard = async (kit: BotKit, typed: BotContext, said: Said): Promise<void> => {
  // Наклейка, геометка или карточка контакта: заявки из них не выйдет, а молчать нельзя.
  // Пустой текст без вложения приходит оттуда же, но человеку нужен другой ответ.
  if (!said.text?.trim() && said.attachments.length === 0) {
    await typed.reply(
      said.text === undefined
        ? 'Такое вложение я не разберу. Напишите словами или пришлите фото, голосовое либо файл.'
        : 'Напишите одной строкой, что случилось.',
      kit.menuKeyboard(await kit.residentOf(typed)),
    );
    return;
  }

  if (said.text && said.attachments.length === 0 && isChatter(said.text)) {
    const who = await kit.residentOf(typed);

    await typed.reply(await menuTitle(kit, who), kit.menuKeyboard(who));
    return;
  }

  // Код из квитанции, набранный сообщением: это привязка квартиры, а не обращение.
  const code = said.text && said.attachments.length === 0 ? normalizeApartmentCode(said.text) : '';

  if (isApartmentCode(code)) return bindByCode(kit, typed, code);

  const number = said.text && said.attachments.length === 0 ? requestNumberIn(said.text) : null;

  if (number) {
    if (await showRequestByNumber(kit, typed, number)) return;

    await typed.reply(`Заявки ${number} у вас нет. Напишите, что случилось, и оформлю новую.`, menuButton(typed));
    return;
  }

  return describeProblem(kit, typed, undefined, said);
};

/** Ответ смежной организации записан словами: он уходит и жильцу. */
const recordAnswerFrom = async (kit: BotKit, typed: BotContext, handoffId: string, answer: string): Promise<void> => {
  forget(typed);

  const staff = await kit.residentOf(typed);

  try {
    const handoff = await answerHandoff(kit.deps, { handoffId, status: 'answered', answer, staff });

    await typed.reply(`Записал ответ: ${handoff.organization}. Жилец уведомлён.`, menuButton(typed));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;

    await typed.reply(`Не записал: ${errorText(error)}`, afterError(error, typed));
  }
};

/** Тема приёма пришла: запись встаёт на выбранный час. */
const bookVisitFrom = async (kit: BotKit, typed: BotContext, at: string, topic: string): Promise<void> => {
  forget(typed);

  const resident = await kit.residentOf(typed);

  try {
    const visit = await takeVisit(kit.deps, { resident, at: new Date(at), topic });
    const zone = await zoneOf(kit.deps, visit.buildingId);

    await typed.reply(`Записал на приём, ${formatVisit(visit, zone)}`, visitCancelKeyboard(visit.id));
  } catch (error) {
    if (await askAgain(typed, error, { kind: 'visit', at })) return;
    if (!(error instanceof DomainError)) throw error;

    // Час мог уйти, пока человек писал тему: возвращать некуда, поэтому часы свежие.
    const { hours } = await freeHours(kit, resident).catch(() => ({ hours: [] }));

    await typed.reply(
      `Не записал: ${errorText(error)}`,
      hours.length > 0 ? visitKeyboard(hours) : afterError(error, typed),
    );
  }
};

/** Продолжение разговора в переписке: сообщение читается по тому, чего бот ждал. */
export const continueDialog = async (kit: BotKit, typed: BotContext, said: Said): Promise<void> => {
  const waiting = typed.session?.awaiting;

  if (!waiting) return heard(kit, typed, said);

  // Из разговора выходят и словом, а не только кнопкой.
  if (said.text && QUIT.test(said.text)) {
    forget(typed);

    await typed.reply('Отменил. Что нужно сделать?', kit.menuKeyboard(await kit.residentOf(typed)));
    return;
  }

  // Снимки и голосовые понимают только эти два ожидания, остальным нужен текст.
  if (waiting.kind === 'reading') return continueReading(kit, typed, waiting.meterId, said);
  if (waiting.kind === 'description') return describeProblem(kit, typed, waiting.target, said);

  // Снимок с подписью и без неё читают там, где он и есть отчёт: сообщение
  // по заявке, вопрос в поддержку и отметка о сделанной работе.
  if (!said.text && said.attachments.length === 0) {
    await typed.reply('Здесь нужен текст: напишите ответ сообщением.', cancelKeyboard());
    return;
  }

  if (waiting.kind === 'support') return askSupportFrom(kit, typed, waiting.ticketId, said);
  if (waiting.kind === 'message') return sendMessage(kit, typed, waiting.requestId, said);

  if (!said.text) {
    if (waiting.kind === 'comment') return explainTransition(kit, typed, waiting, 'Фото работы', said);

    await typed.reply('Здесь нужен текст: напишите ответ сообщением.', cancelKeyboard());
    return;
  }
  if (waiting.kind === 'visit') return bookVisitFrom(kit, typed, waiting.at, said.text);
  if (waiting.kind === 'handoff') return recordAnswerFrom(kit, typed, waiting.handoffId, said.text);
  if (waiting.kind === 'code') return takeCode(kit, typed, said.text);
  if (waiting.kind === 'assistant') return answerFromAssistant(kit, typed, said.text);

  return explainTransition(kit, typed, waiting, said.text, said);
};
