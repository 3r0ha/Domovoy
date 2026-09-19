import {
  actionsFor,
  answerSupport,
  askSupport,
  answerHandoff,
  bindApartment,
  commentRequest,
  contactsFor,
  describeFromAttachments,
  metersFor,
  offTopicFor,
  readingInWords,
  sectionFor,
  submitProblem,
  takeVisit,
  transitionRequest,
  unheardVoice,
  formatVisit,
  zoneOf,
  type Resident,
} from '@domovoy/app';
import {
  APARTMENT_CODE_LENGTH,
  DomainError,
  isApartmentCode,
  isCompanyStaff,
  mentionsNumber,
  normalizeApartmentCode,
  numberFromWords,
  requestNumberIn,
  suggestCategory,
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
  confirmKeyboard,
  COMMENT_DONE,
  decimal,
  errorText,
  menuButton,
  metersForValueKeyboard,
  metersKeyboard,
  oneKeyboard,
  replyIfOpen,
  visitCancelKeyboard,
  visitKeyboard,
} from './keyboards.js';
import { offerDoing } from './doing.js';
import { answerFromAssistant } from './talk.js';
import { thinking } from './thinking.js';
import { inApp } from './commands/in-app.js';
import { freeHours } from './commands/visits.js';
import { readFromPhoto, takeReading } from './readings.js';
import { expect, forget, isChatter, QUIT, strong, type Awaiting, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Человек спрашивает, а не рассказывает: с вопросом это разговор, а не заявка. */
const ASKING = /\?|^\s*(когда|почему|зачем|сколько|как|где|кто|что с|можно ли|подскажите|скажите)\b/iu;

/** Что пришло от человека: текст, снимки или и то и другое. */
export interface Said {
  text?: string | undefined;
  attachments: Attachment[];
}

/**
 * Почему обращение не приняли. Адрес и предел заявок это разные беды, и совет
 * у них разный: раньше к любому отказу приписывался совет про наклейку.
 */
const explainRefusal = async (
  kit: BotKit,
  typed: BotContext,
  resident: Resident,
  error: DomainError,
): Promise<void> => {
  if (error.code === 'target_required') {
    await typed.reply(
      isCompanyStaff(resident.role)
        ? `${error.message}. Выберите дом и квартиру в приложении: обращение жильца заводится на его адрес.`
        : `${error.message}. Отсканируйте код на подъезде или откройте приложение, там можно выбрать адрес.`,
      kit.openApp(undefined, typed),
    );

    return;
  }

  // Предел заявок за час может прийтись на аварию: тогда человеку нужен
  // не совет подождать, а телефон круглосуточной службы.
  const urgent = error.code === 'too_many_requests' ? await emergencyLine(kit, resident) : '';

  await typed.reply(`${errorText(error)}.${urgent}`, afterError(error, typed));
};

/** Телефон круглосуточной службы: он нужен там, где заявку принять не вышло. */
const emergencyLine = async (kit: BotKit, resident: Resident): Promise<string> => {
  const contacts = await contactsFor(kit.deps, resident).catch(() => undefined);
  const phone = contacts?.service?.emergencyPhone;

  return phone ? `\nЕсли это авария, звоните круглосуточно: ${phone}.` : '';
};

/**
 * Показание, поданное словами: «холодная вода 12345». Прибор назван, число
 * названо, и ходить за этим в раздел незачем.
 */
const readingBySaying = async (kit: BotKit, typed: BotContext, text: string): Promise<boolean> => {
  const resident = await kit.residentOf(typed);
  const said = await readingInWords(kit.deps, resident, text).catch(() => []);

  if (said.length === 0) return false;

  // Приборы называют и по два сразу: «гвс 9800 хвс 12350» это два показания.
  for (const reading of said) {
    // Приборов такого вида несколько: чьё это число, знает только человек.
    if (reading.meters.length > 1) {
      await typed.reply(
        `Показание ${decimal(reading.value)}: счётчиков такого вида у вас несколько. Выберите, чей это.`,
        metersKeyboard(reading.meters),
      );

      continue;
    }

    await takeReading(kit, typed, reading.meters[0]!.meter.id, String(reading.value));
  }

  return true;
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
/**
 * Сделанное по словам: человек написал, что ему нужно, и продукт открывает
 * нужный раздел сам. Так ботом управляют словами, а не только кнопками.
 * @returns правда, если дело сделано и заявка не нужна.
 */
const doneByWords = async (
  kit: BotKit,
  typed: BotContext,
  resident: Awaited<ReturnType<BotKit['residentOf']>>,
  text: string,
): Promise<boolean> => {
  const to = await sectionFor(kit.deps, resident, text).catch(() => undefined);

  if (!to) return false;

  forget(typed);

  const command = to.command?.replace(/^\//, '');

  if (command && (await kit.run(command, typed))) return true;

  // Раздел, которого в переписке нет: «капитальный ремонт», «план дома». Раньше
  // такие слова уходили в заявку и упирались в отказ «напишите словами».
  await inApp(kit, typed, `${strong(to.title)}\n${to.about}.`, to.screen, 'Смотреть');

  return true;
};

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

    // Дело по уже открытой заявке: «починил трубу», «работу принял», «отзываю
    // заявку». Продукт показывает, что понял, и ждёт нажатия: закрывать заявку
    // по одной фразе нельзя, а переспрашивать обо всём подряд мучительно.
    if (attachments.length === 0 && (await offerDoing(kit, typed, description))) {
      forget(typed);

      return;
    }

    // Просьба сделать дело, а не рассказ о поломке: «открыть дверь», «оплатить
    // счёт». Продукт выполняет её, а не заводит по ней заявку и не отказывает.
    if (attachments.length === 0 && (await doneByWords(kit, typed, resident, description))) return;

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

    await explainRefusal(kit, typed, resident, error);
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

  // Смена отвечает на выбранное обращение, у него есть номер. Без номера это
  // её собственный вопрос как жильца: сотрудник тоже живёт в квартире.
  const answering = isCompanyStaff(resident.role) && ticketId !== undefined;

  try {
    const ticket = answering
      ? await answerSupport(kit.deps, { staff: resident, ticketId, text: said.text ?? '' })
      : await askSupport(kit.deps, {
          resident,
          text: said.text ?? '',
          ...(ticketId ? { ticketId } : {}),
          ...(said.attachments.length ? { attachments: said.attachments } : {}),
        });

    await typed.reply(
      answering
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

/**
 * Ответ на вопрос о показании: цифры, между ними пробелы и запятая, в конце
 * единица измерения. Всё остальное это уже другой разговор.
 */
const ANSWERED_NUMBER = /^[^\p{L}\d]*\d[\d\s.,]*(?:\s*(?:м3|м³|куб\.?\s?м\.?|квт\S*|гкал)\.?)?[^\p{L}\d]*$/iu;

/** Показание приходит числом, а без числа, снимком табло. */
const continueReading = async (kit: BotKit, typed: BotContext, meterId: string, said: Said): Promise<void> => {
  if (said.text) {
    // Голосом показание диктуют словами, и это тот же ответ на тот же вопрос.
    if (ANSWERED_NUMBER.test(said.text) || numberFromWords(said.text) !== undefined) {
      return takeReading(kit, typed, meterId, said.text);
    }

    // Число человек назвать пытался, но разобрать его не вышло: «примерно сто»
    // показанием не делают, а переспрашивают о том же.
    if (mentionsNumber(said.text)) return takeReading(kit, typed, meterId, said.text);

    // Человек передумал и рассказывает о поломке или спрашивает: держать его
    // в вопросе о цифрах значит не принять аварию и не ответить на вопрос.
    forget(typed);

    return heard(kit, typed, said);
  }

  // Молчать нельзя: жилец ждёт ответа на присланное, чем бы оно ни было.
  await readFromPhoto(kit, typed, meterId, said.attachments.find((file) => file.kind === 'photo')?.token);
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

/** Сообщение из одного числа: «12345». Про какой это прибор, оно не говорит. */
const NUMBER_ALONE = /^\s*(\d{1,7}(?:[.,]\d{1,4})?)\s*$/u;

/**
 * Голое число прибора не называет, а счётчиков в квартире несколько. Продукт
 * не решает за человека, холодная это вода или горячая: он спрашивает, а число
 * уже держит при себе, чтобы не набирать его снова.
 */
const askWhichMeter = async (kit: BotKit, typed: BotContext, text: string): Promise<boolean> => {
  const digits = NUMBER_ALONE.exec(text)?.[1];

  if (digits === undefined) return false;

  const resident = await kit.residentOf(typed);
  const value = Number(digits.replace(',', '.'));

  if (!resident.apartmentId || !Number.isFinite(value)) return false;

  const now = kit.deps.now();
  const meters = (await metersFor(kit.deps, resident).catch(() => [])).filter(
    (state) => verificationState(state.meter, now) !== 'expired',
  );

  if (meters.length === 0) return false;

  await typed.reply(
    `Похоже на показание ${strong(decimal(value))}. Какого это счётчика?`,
    metersForValueKeyboard(meters, value),
  );

  return true;
};

/**
 * Сообщение состоит из одного кода и ничего больше. Без этой проверки кодом
 * оказывалось любое сообщение с восемью знаками: «хвс 99999999» отвечало
 * отказом в привязке вместо показания.
 */
const codeAlone = (text: string): boolean =>
  new RegExp(`^[a-z0-9]{${APARTMENT_CODE_LENGTH}}$`, 'iu').test(text.trim().replace(/[\s-]/gu, ''));

/** Код квартиры ждут отдельно: пока он не подошёл, ответ остаётся о коде. */
const takeCode = async (kit: BotKit, typed: BotContext, text: string): Promise<void> => {
  const code = normalizeApartmentCode(text);

  if (!isApartmentCode(code)) {
    // Знаков может быть ровно восемь, а не подойти буква: в коде нет тех,
    // которые путают с цифрами, и про это надо сказать отдельно.
    await typed.reply(
      code.length === APARTMENT_CODE_LENGTH
        ? 'В коде есть буква, которой в нём не бывает. Похожие на цифры буквы в код не попадают, ' +
            'посмотрите его в квитанции ещё раз.'
        : `Код не подошёл: в нём должно быть ${APARTMENT_CODE_LENGTH} знаков, а вы прислали ${code.length}. ` +
            'Наберите его заново.',
      cancelKeyboard(),
    );

    return;
  }

  const resident = await kit.residentOf(typed);
  const flat = await kit.deps.repository.findApartmentByCode(code).catch(() => undefined);

  // Своя квартира уже привязана, а код ведёт в другую: он увёл бы человека
  // вместе со счётчиками и квитанцией, поэтому нужен его ответ. Неизвестный
  // код при этом разбирается обычным путём, с обычным отказом.
  if (flat && resident.apartmentId && flat.id !== resident.apartmentId) {
    await typed.reply(
      `Квартира у вас уже привязана. Этот код привяжет квартиру ${flat.number}. Привязать её?`,
      confirmKeyboard('🏢 Да, привязать', `bind:${code}`),
    );

    return;
  }

  await bindByCode(kit, typed, code);
};

/**
 * Что делается по одним словам, без вложений: дело по заявке, показание,
 * короткая вежливость, код из квитанции и номер заявки. Возвращает, нашлось ли
 * такое дело: иначе сказанное разбирается как обращение.
 */
const doneBySaying = async (kit: BotKit, typed: BotContext, text: string): Promise<boolean> => {
  // Дело по открытой заявке разбирается раньше вежливости: «всё сделали,
  // спасибо» это приёмка работы, а не разговор ни о чём.
  if (await offerDoing(kit, typed, text)) return true;

  // Показание словами разбирается раньше короткой вежливости: «хвс 145» короче
  // разговорной реплики, но это поданное показание, а не разговор.
  if (await readingBySaying(kit, typed, text)) return true;
  if (await askWhichMeter(kit, typed, text)) return true;

  if (isChatter(text)) {
    const who = await kit.residentOf(typed);

    await typed.reply(await menuTitle(kit, who), kit.menuKeyboard(who));

    return true;
  }

  // Код из квитанции, набранный сообщением: это привязка квартиры, а не обращение.
  if (codeAlone(text)) {
    await takeCode(kit, typed, text);

    return true;
  }

  const number = requestNumberIn(text);

  if (!number) return false;

  if (await showRequestByNumber(kit, typed, number)) return true;

  await typed.reply(`Заявки ${number} у вас нет. Напишите, что случилось, и оформлю новую.`, menuButton(typed));

  return true;
};

/**
 * Просьба не про дом: рецепт, спор о политике, попытка выманить настройки.
 * Заявкой такое не становится, иначе смена разбирает поток постороннего.
 * Слова продукта перевешивают отказ модели: «течёт кран» это поломка, чем бы
 * модель её ни посчитала.
 */
const notAboutHouse = async (kit: BotKit, typed: BotContext, text: string): Promise<boolean> => {
  const reasoner = kit.deps.reasoner;

  if (!reasoner?.onTopic || suggestCategory(text) !== 'other') return false;

  const resident = await kit.residentOf(typed);
  const about = await reasoner.onTopic(text, isCompanyStaff(resident.role)).catch(() => undefined);

  if (about !== false) return false;

  await typed.reply(
    offTopicFor(resident.role),
    isCompanyStaff(resident.role) ? menuButton(typed) : oneKeyboard('✉️ Вопрос компании', 'menu:support'),
  );

  return true;
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

  const words = said.attachments.length === 0 ? said.text : undefined;

  if (words && (await doneBySaying(kit, typed, words))) return;
  if (words && (await notAboutHouse(kit, typed, words))) return;

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

/**
 * Сказанное голосом становится обычным текстом до всякого разбора: тогда
 * голосом отвечают на любой вопрос продукта, а не только на «что случилось».
 * Расшифровка остаётся при вложении, поэтому второй раз её не спрашивают.
 */
const readAloud = async (kit: BotKit, said: Said): Promise<Said> => {
  if (said.text?.trim() || !kit.transcriber) return said;

  const voice = said.attachments.find((file) => file.kind === 'voice' && !file.transcript);

  if (!voice) return said;

  const text = await kit.transcriber.transcribe(voice).catch(() => undefined);

  if (!text) return said;

  return {
    text,
    attachments: said.attachments.map((file) => (file === voice ? { ...file, transcript: text } : file)),
  };
};

/** Продолжение разговора в переписке: сообщение читается по тому, чего бот ждал. */
export const continueDialog = async (kit: BotKit, typed: BotContext, original: Said): Promise<void> => {
  const said = await readAloud(kit, original);
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
  // Разговор с помощником не съедает рассказ о поломке: человек пришёл спросить,
  // а по дороге увидел течь, и заявка ему нужнее продолжения разговора.
  if (waiting.kind === 'assistant') {
    if (suggestCategory(said.text) !== 'other' && !ASKING.test(said.text)) {
      return describeProblem(kit, typed, undefined, said);
    }

    return answerFromAssistant(kit, typed, said.text);
  }

  return explainTransition(kit, typed, waiting, said.text, said);
};
