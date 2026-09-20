import type { Attachment } from '@domovoy/domain';
import { languageTitle, translatorFor, type Language, type Translate } from '@domovoy/i18n';

import { speakLanguage } from './i18n.js';

/** Состояние диалога: чего бот ждёт от следующего сообщения. */
export interface DialogSession {
  awaiting?: Awaiting;
  /** Язык разговора: выходы дописываются вне обработчика, где человека уже нет. */
  lang?: Language;
  /** Код из ссылки, отложенный до выбора языка: разговор продолжится с него. */
  afterLang?: string;
  /** Язык последнего сообщения, если он не тот, что выбран: на него зовут кнопкой. */
  offerLang?: Language;
  /** Обращение, на которое ответили плановыми работами. */
  plannedDescription?: string;
  plannedTarget?: string;
  /** Команда, о которой просили до согласия с документами: она выполнится после. */
  afterLegal?: string;
  /** Объект с наклейки, по которому пришёл жилец без квартиры: разговор о нём продолжится после привязки. */
  afterBind?: string;
  /** Варианты последнего уточняющего вопроса: под кнопкой лежит их номер. */
  where?: { requestId: string; options: { label: string; startParam: string }[] };
  /** Открытая группа меню: в неё возвращает отмена, а не в первый экран. */
  menu?: string;
  /** Показанная подсказка «напишите…»: её убирают, когда она перестала ждать. */
  prompt?: string;
  /** Текущий экран разговора: его правят на месте, остальное не трогают. */
  screen?: string;
  /** Наряд, по которому мастер отсканировал наклейку: отметка уйдёт со сдачей. */
  proved?: { requestId: string; code: string };
  /** Разговор с помощником: прошлые реплики, чтобы вопрос читался в контексте. */
  talk?: { asked: string; said: string }[];
  /** Дело, названное словами: ждёт подтверждения кнопкой. */
  doing?: { token: string; to: string; comment: string };
}

/** Чего бот ждёт от следующего сообщения. Ожидание всегда одно. */
export type Awaiting =
  | { kind: 'description'; target?: string; photos?: Attachment[] }
  | { kind: 'support'; ticketId?: string }
  | { kind: 'reading'; meterId: string }
  | { kind: 'message'; requestId: string }
  | { kind: 'comment'; requestId: string; to: string }
  | { kind: 'visit'; at: string }
  | { kind: 'handoff'; handoffId: string }
  | { kind: 'code' }
  | { kind: 'assistant' };

/** Язык разговора по запомненному в сессии: человека здесь уже нет. */
export const speaking = (context: { session?: DialogSession }): Translate =>
  speakLanguage(context.session?.lang);

/** Новое ожидание вытесняет прежнее. */
export const expect = (context: { session?: DialogSession }, awaiting: Awaiting): void => {
  context.session ??= {};
  context.session.awaiting = awaiting;
};

/** Ожидание снимается, как только ответ пришёл. */
export const forget = (context: { session?: DialogSession }): void => {
  if (context.session) delete context.session.awaiting;
};

/**
 * Невидимая метка разметки. Она ставится там, где текст собрал сам продукт, и
 * снимается перед отправкой: звёздочки из письма жильца или из ответа модели
 * разметку уже не включают и остаются самими собой.
 */
const MARKUP = '⁠';

/** Жирным выделяется главное в сообщении: номер заявки, сумма, срок. */
export const strong = (text: string): string => `${MARKUP}**${text}**`;

/** Чужой текст внутри размеченного сообщения: знаки разметки в нём обезвреживаются. */
export const plain = (text: string): string => text.replace(/([*_~`[\]()>#])/gu, '\\$1');

/** Текст к отправке и способ его показа: разметка включается только по метке. */
export const shown = (
  text: string,
  extra?: Record<string, unknown>,
): { text: string; extra: Record<string, unknown> | undefined } =>
  text.includes(MARKUP)
    ? { text: text.replaceAll(MARKUP, ''), extra: { ...(extra ?? {}), format: 'markdown' } }
    : { text, extra };

/** Сколько реплик помощник держит в голове: дальше разговор уходит в сторону. */
export const TALK_DEPTH = 6;

/** Разговор с помощником закончен: следующий вопрос начинается с чистого листа. */
export const endTalk = (context: { session?: DialogSession }): void => {
  if (context.session) delete context.session.talk;
};

/** Сказанное в разговоре запоминается парами: вопрос и ответ. */
export const remember = (context: { session?: DialogSession }, asked: string, said: string): void => {
  context.session ??= {};
  context.session.talk = [...(context.session.talk ?? []), { asked, said }].slice(-TALK_DEPTH);
};

export type BotContext = {
  session?: DialogSession;
  reply: (text: string, extra?: Record<string, unknown>) => Promise<unknown>;
  update: Record<string, unknown>;
  message?: {
    /** Кто написал: у комментария под постом отправитель есть только здесь. */
    sender?: { user_id?: number; first_name?: string; last_name?: string };
    body?: { mid?: string; text?: string; attachments?: MaxAttachment[]; markup?: MaxMarkup[] | null };
    /** Куда пришло сообщение: личная переписка, чат дома или канал. */
    recipient?: { chat_type?: string; post_id?: number | string | null };
    /** Сообщение, на которое ответили: в чате им и объясняют, о чём речь. */
    link?: { type?: string; sender?: { user_id?: number }; message?: { text?: string | null } };
  };
  callback?: {
    /** Чем отвечать на нажатие: всплывающее уведомление уходит по нему. */
    callback_id?: string;
    payload?: string;
    user?: { user_id?: number; first_name?: string; last_name?: string };
  };
  /** Нажатие уже закрыто ответом: второй раз платформа его не примет. */
  settled?: boolean;
  user?: { user_id?: number; first_name?: string; last_name?: string };
  chatId?: number;
  /** Идентификатор самого бота: по нему узнаётся обращение в общем чате. */
  myId?: number;
  api: { answerOnCallback: (id: string, extra?: Record<string, unknown>) => Promise<unknown> };
};

/** Сколько знаков помещается во всплывающем уведомлении. */
const TOAST_MAX_LENGTH = 200;

/**
 * Ответ на нажатие кнопки. Короткий итог показывается всплывающим уведомлением,
 * а не сообщением в переписке. Без ответа кнопка у нажавшего остаётся в ожидании.
 */
export const toast = async (context: BotContext, text?: string): Promise<void> => {
  const id = context.callback?.callback_id;

  if (!id || context.settled) return;

  context.settled = true;

  const short = text?.trim();

  await context.api
    .answerOnCallback(id, short ? { notification: short.slice(0, TOAST_MAX_LENGTH) } : {})
    .catch(() => undefined);
};

/**
 * Выход с экрана: первый экран меню и шаг назад, туда откуда пришли, в одном
 * ряду и в таком порядке. Одного «Назад» мало: из «Мои данные» человек хочет
 * и в «Ещё», и в меню.
 */
const menuButtonOf = (t: Translate) => ({ type: 'callback', text: t('button.menu'), payload: 'group:back' });
const backButtonOf = (t: Translate) => ({ type: 'callback', text: t('button.back'), payload: 'cancel' });

/**
 * Первый экран меню: возвращаться с него некуда, и у подрядчика, у которого
 * групп нет, «Назад» вело бы на него же.
 */
export const ROOT_MENUS = new WeakSet<object>();

/** Кому уже сказали, что не вышло: второй раз об одном и том же не пишут. */
export const APOLOGIZED = new WeakSet<object>();

/**
 * Подсказка, которая ждёт ответа сообщением. Такие экраны живут до ответа
 * или отмены, а потом убираются: иначе в переписке остаётся ряд «Отмена»,
 * по которым уже нечего отменять.
 */
export const PROMPTS = new WeakSet<object>();

/**
 * Экран разговора: меню, группа, подсказка и рассказ о разделе приложения.
 * Такие сообщения переписываются на месте, а чек заявки или код гостя нет.
 */
export const SCREENS = new WeakSet<object>();

/** Сообщение, под которым нажали кнопку. */
export const pressedMid = (context: BotContext): string | undefined => context.message?.body?.mid;

/** Номер отправленного сообщения: по нему его потом и убирают. */
export const midOf = (sent: unknown): string | undefined =>
  (sent as { body?: { mid?: string } } | undefined)?.body?.mid;

/** Служба сообщений бота: правка и удаление идут через неё. */
export interface Messages {
  deleteMessage: (mid: string) => Promise<unknown>;
}

/**
 * Прежняя подсказка убирается, как только появляется новая или человек ушёл:
 * это и есть тот самый мусор из «Отмена», которым обрастает переписка.
 */
export const dropPrompt = async (context: BotContext, messages: Messages): Promise<void> => {
  const mid = context.session?.prompt;

  if (!mid) return;

  delete context.session?.prompt;

  await messages.deleteMessage(mid).catch(() => undefined);
};

/** Ряды кнопок сообщения: у вложения клавиатуры они лежат в payload. */
interface KeyboardAttachment {
  type?: string;
  payload?: { buttons?: { payload?: string }[][] };
}

/** Ряды кнопок сообщения, если они там есть. */
const rowsIn = (extra: Record<string, unknown> | undefined): { payload?: string }[][] => {
  const attachments = extra?.['attachments'];

  if (!Array.isArray(attachments)) return [];

  const keyboard = (attachments as KeyboardAttachment[]).find(
    (attachment) => attachment.type === 'inline_keyboard',
  );

  return keyboard?.payload?.buttons ?? [];
};

/**
 * Экран, который ждёт ответа сообщением: под ним всегда есть отмена. Такими
 * оказываются и подсказка, и вопрос о показании, и подтверждение удаления.
 */
const asksAnswer = (extra: Record<string, unknown> | undefined): boolean =>
  extra !== undefined &&
  (PROMPTS.has(extra) || rowsIn(extra).some((row) => row.some((button) => button.payload === 'cancel')));

/**
 * Слежение за экраном разговора: подсказки не копятся, а выходы дописываются
 * ко всему, что бот отправляет в переписку.
 */
export const screenKeeper =
  (messages: Messages) =>
  async (context: never, next: () => Promise<void>): Promise<void> => {
    const typed: BotContext = context;
    const send = typed.reply.bind(typed);
    const waited = typed.session?.awaiting;

    // Экран с отменой становится подсказкой, только если бот и правда ждёт
    // ответа словами. Подтверждение «Удалить профиль?» ждёт кнопки и остаётся.
    let asked: string | undefined;

    typed.reply = async (text: string, extra?: Record<string, unknown>): Promise<unknown> => {
      const asking = asksAnswer(extra);

      if (asking) await dropPrompt(typed, messages);

      // Экран в переписке живёт один: прежний убирается, когда появился новый.
      // Иначе меню, список счётчиков и подтверждение копятся столбиком, и
      // человек листает вверх, чтобы понять, где он сейчас.
      const previous = extra !== undefined && SCREENS.has(extra) ? typed.session?.screen : undefined;

      const ready = shown(text, withBack(extra, typed));
      const sent = await send(ready.text, ready.extra);

      if (extra !== undefined && SCREENS.has(extra)) {
        typed.session ??= {};
        typed.session.screen = midOf(sent);

        const now = midOf(sent);

        if (previous && now && previous !== now) {
          if (typed.session.prompt === previous) delete typed.session.prompt;

          await messages.deleteMessage(previous).catch(() => undefined);
        }
      }

      if (asking) asked = midOf(sent);

      return sent;
    };

    await next();

    if (typed.session?.awaiting && asked) typed.session.prompt = asked;

    // Подсказка, которая уже ничего не ждёт: на неё ответили или её отменили.
    // Оставлять её в переписке значит копить ряды «Отмена» без дела.
    if (typed.session?.prompt && !typed.session.awaiting) await dropPrompt(typed, messages);

    // Ответ на подсказку тоже убирается: «6» и «-» в переписке не нужны,
    // а сказанное по делу видно в самой заявке. Платформа может не разрешить.
    const answered = waited !== undefined && typed.session?.awaiting === undefined;
    const mid = pressedMid(typed);

    if (answered && mid && !typed.callback) await messages.deleteMessage(mid).catch(() => undefined);
  };

/** Что из выходов на экране уже есть: второй такой же кнопки не нужно. */
const exits = (rows: { payload?: string }[][]): { back: boolean; menu: boolean } => {
  const all = rows.flat();

  return {
    back: all.some((button) => button.payload === 'cancel'),
    menu: all.some((button) => button.payload?.startsWith('group:')),
  };
};

/**
 * Возврат дописывается к любой клавиатуре в переписке: человек всегда видит,
 * как уйти с экрана. В общем чате его нет: меню там личное.
 */
export const withBack = (extra: Record<string, unknown> | undefined, context: BotContext): typeof extra => {
  if (inChat(context) || (extra && ROOT_MENUS.has(extra))) return extra;

  const t = speaking(context);

  // Ответ вообще без кнопок это самый частый тупик: человеку нечего нажать,
  // и он уходит набирать команду заново.
  if (!extra) {
    return {
      attachments: [
        { type: 'inline_keyboard', payload: { buttons: [[menuButtonOf(t), backButtonOf(t)]] } },
      ],
    };
  }

  const attachments = extra['attachments'];

  if (!Array.isArray(attachments)) return extra;

  const rowsOf = (attachment: KeyboardAttachment): { payload?: string }[][] | undefined =>
    attachment.type === 'inline_keyboard' ? attachment.payload?.buttons : undefined;

  const keyboard = (attachments as KeyboardAttachment[]).find((attachment) => rowsOf(attachment) !== undefined);

  const rows = keyboard?.payload?.buttons;

  if (!rows) return extra;

  const has = exits(rows);
  const offer = languageRow(context, rows);

  // Где человек уже может выйти отменой, второй выход только мешает.
  if (has.back && offer.length === 0) return extra;

  const added = has.back ? [] : [[...(has.menu ? [] : [menuButtonOf(t)]), backButtonOf(t)]];

  return {
    ...extra,
    attachments: attachments.map((attachment: KeyboardAttachment) =>
      attachment === keyboard
        ? { ...attachment, payload: { ...attachment.payload, buttons: [...rows, ...offer, ...added] } }
        : attachment,
    ),
  };
};

/**
 * Переход на язык последнего сообщения. Человек написал на языке, который
 * продукт знает, а читает на другом: ответ он получает сразу, а язык меняет
 * одной кнопкой, не разыскивая раздел.
 */
const languageRow = (context: BotContext, rows: { payload?: string }[][]): { payload?: string }[][] => {
  const code = context.session?.offerLang;

  if (!code) return [];

  const already = rows.some((row) => row.some((button) => button.payload?.startsWith('lang:')));

  if (already) return [];

  const voice = translatorFor(code);

  return [
    [
      {
        type: 'callback',
        text: voice('app.assistant.languageButton', { язык: languageTitle(code) }),
        payload: `lang:${code}`,
      } as { payload?: string },
    ],
  ];
};

/**
 * Ответ на нажатие с новым содержимым: сообщение с кнопками переписывается
 * на месте. Переписка от хождения по меню не растёт, а прежний экран исчезает
 * вместе с кнопками, по которым уже нажали.
 */
export const replace = async (
  context: BotContext,
  text: string,
  extra?: Record<string, unknown>,
): Promise<boolean> => {
  const id = context.callback?.callback_id;

  if (!id || context.settled) return false;

  context.settled = true;

  // Правка сообщения идёт тем же путём, что и отправка: без пометки формата
  // переписанный экран показал бы звёздочки вместо жирного.
  const ready = shown(text, extra);

  return context.api
    .answerOnCallback(id, { message: { text: ready.text, ...(ready.extra ?? {}) } })
    .then(() => true)
    .catch(() => {
      // Платформа правку не приняла: обычной отправкой человек хотя бы получит ответ.
      context.settled = false;
      return false;
    });
};

/**
 * Обработчик пишет туда же, где стояла нажатая кнопка. Первый ответ правит
 * сообщение, остальные уходят обычным порядком: за одно нажатие экран один.
 */
export const morphing = (context: BotContext): BotContext => {
  const original = context.reply.bind(context);
  let first = true;

  context.reply = async (text: string, extra?: Record<string, unknown>): Promise<unknown> => {
    if (!first) return original(text, extra);

    first = false;

    // Правка идёт мимо обычной отправки, поэтому возврат дописывается здесь же.
    if (await replace(context, text, withBack(extra, context))) {
      context.session ??= {};
      context.session.screen = pressedMid(context);

      // Подсказку переписали: убирать её теперь нельзя, на её месте новый экран.
      if (context.session.prompt === context.session.screen) delete context.session.prompt;

      // А если новый экран сам спрашивает, он и становится подсказкой:
      // ответят на неё, и она уйдёт из переписки.
      if (extra !== undefined && PROMPTS.has(extra)) context.session.prompt = context.session.screen;

      return undefined;
    }

    return original(text, extra);
  };

  return context;
};

/** Разметка текста: из неё видно упоминание бота. */
export interface MaxMarkup {
  type?: string;
  from?: number;
  length?: number;
  user_id?: number | null;
}

/** Разговор идёт при соседях: в общем чате дома или в канале. */
export const inChat = (context: BotContext): boolean => {
  const type = context.message?.recipient?.chat_type;

  return type === 'chat' || type === 'channel';
};

export const mentionsOf = (context: BotContext): MaxMarkup[] =>
  (context.message?.body?.markup ?? []).filter(
    (markup) => markup.type === 'user_mention' && markup.user_id === context.myId,
  );

/** К боту обратились: назвали по имени или ответили на его сообщение. */
export const addressed = (context: BotContext): boolean =>
  mentionsOf(context).length > 0 ||
  (context.message?.link?.type === 'reply' && context.message.link.sender?.user_id === context.myId);

/** Текст без обращения: «@Домовой в подъезде темно» превращается в «в подъезде темно». */
export const withoutMention = (context: BotContext): string => {
  const mentions = [...mentionsOf(context)].sort((left, right) => (right.from ?? 0) - (left.from ?? 0));
  let text = context.message?.body?.text ?? '';

  for (const mention of mentions) {
    const from = mention.from ?? 0;

    text = `${text.slice(0, from)}${text.slice(from + (mention.length ?? 0))}`;
  }

  return text.trim();
};

/** Слово выхода из разговора: его пишут вместо нажатия «Отмена». */
export const QUIT = /^(отмена|отменить|стоп|хватит|выход)[\s!.]*$/i;

/** Короткая вежливость заявкой не становится. */
export const SMALL_TALK = /^(спасибо|благодарю|привет|здравствуй(те)?|добрый (день|вечер)|доброе утро|ок|окей|хорошо|ага|да|нет|\+|\?)[\s!.,)]*$/i;

/** Есть ли в сообщении слова: из одних значков заявку не составить. */
const HAS_WORDS = /[\p{L}\p{N}]{2}/u;

/**
 * Слова, по которым короткое сообщение всё-таки дело: «течь», «лифт», «свет».
 * Ими человек и пишет чаще всего, а порог по длине отправлял их в меню.
 */
const SHORT_BUT_CLEAR =
  /^(теч[ьи]|потоп|залив|лифт|свет|вода|воды|тепло|мусор|засор|шум|домофон|дверь|ворота|кран|труба|батаре[яи]|окно|подвал|крыша)[\s!.,]*$/iu;

/** Сообщение без сути: приветствие, благодарность, пара слов или одни значки. */
export const isChatter = (text: string): boolean => {
  const said = text.trim();

  if (SHORT_BUT_CLEAR.test(said)) return false;

  return said.length < 8 || !HAS_WORDS.test(said) || SMALL_TALK.test(said);
};

/** Команды, ответ на которые виден только спрашивающему. */
export const PRIVATE_COMMANDS = new Set([
  'new',
  'my',
  'meters',
  'bill',
  'door',
  'mydata',
  'gzhi',
  'debts',
  'flat',
  'support',
  'stickers',
  'duty',
  'broadcast',
  'report',
  'queue',
  'legal',
  'lang',
]);

/** Команды с продолжением: бот спрашивает, человек отвечает. Из чата уводятся в переписку. */
export const DIALOG_COMMANDS = new Set(['new', 'meters', 'support', 'broadcast']);

/** Дела смены: ответ уходит в переписку молча, соседям в чате он не нужен. */
export const QUIET_COMMANDS = new Set(['debts', 'report', 'duty', 'queue']);

/** Вложение в том виде, в каком его приносит Bot API. */
export interface MaxAttachment {
  type?: string;
  payload?: { token?: string; url?: string };
}

/** Вложения MAX в вид, понятный продукту. */
export const ATTACHMENT_KINDS: Record<string, Attachment['kind']> = {
  image: 'photo',
  photo: 'photo',
  audio: 'voice',
  voice: 'voice',
  file: 'file',
  video: 'file',
};

export const toAttachments = (attachments: readonly MaxAttachment[] = []): Attachment[] =>
  attachments.flatMap((attachment): Attachment[] => {
    const token = attachment.payload?.token ?? attachment.payload?.url;
    const kind = attachment.type === undefined ? undefined : ATTACHMENT_KINDS[attachment.type];

    return token && kind ? [{ kind, token }] : [];
  });

export const nameOf = (user?: { first_name?: string; last_name?: string }): string =>
  [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Жилец';

