import type { Attachment } from '@domovoy/domain';

/** Состояние диалога: чего бот ждёт от следующего сообщения. */
export interface DialogSession {
  awaiting?: Awaiting;
  /** Обращение, на которое ответили плановыми работами. */
  plannedDescription?: string;
  plannedTarget?: string;
  /** Команда, о которой просили до согласия с документами: она выполнится после. */
  afterLegal?: string;
  /** Варианты последнего уточняющего вопроса: под кнопкой лежит их номер. */
  where?: { requestId: string; options: { label: string; startParam: string }[] };
}

/** Чего бот ждёт от следующего сообщения. Ожидание всегда одно. */
export type Awaiting =
  | { kind: 'description'; target?: string }
  | { kind: 'support'; ticketId?: string }
  | { kind: 'reading'; meterId: string }
  | { kind: 'message'; requestId: string }
  | { kind: 'comment'; requestId: string; to: string }
  | { kind: 'visit'; at: string }
  | { kind: 'handoff'; handoffId: string }
  | { kind: 'assistant' };

/** Новое ожидание вытесняет прежнее. */
export const expect = (context: { session?: DialogSession }, awaiting: Awaiting): void => {
  context.session ??= {};
  context.session.awaiting = awaiting;
};

/** Ожидание снимается, как только ответ пришёл. */
export const forget = (context: { session?: DialogSession }): void => {
  if (context.session) delete context.session.awaiting;
};

export type BotContext = {
  session?: DialogSession;
  reply: (text: string, extra?: Record<string, unknown>) => Promise<unknown>;
  update: Record<string, unknown>;
  message?: {
    /** Кто написал: у комментария под постом отправитель есть только здесь. */
    sender?: { user_id?: number; first_name?: string; last_name?: string };
    body?: { text?: string; attachments?: MaxAttachment[]; markup?: MaxMarkup[] | null };
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

/** Сообщение без сути: приветствие, благодарность, пара слов или одни значки. */
export const isChatter = (text: string): boolean =>
  text.length < 8 || !HAS_WORDS.test(text) || SMALL_TALK.test(text);

/** Команды, ответ на которые виден только спрашивающему. */
export const PRIVATE_COMMANDS = new Set([
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
]);

/** Команды с продолжением: бот спрашивает, человек отвечает. Из чата уводятся в переписку. */
export const DIALOG_COMMANDS = new Set(['meters', 'support', 'broadcast']);

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

