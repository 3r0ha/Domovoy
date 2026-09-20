import {
  CATEGORY_RULES,
  INSPECTION_RULES,
  allowedTransitions,
  categoryKey,
  describeAudience,
  describeTarget,
  describeUntil,
  findTransition,
  formatClock,
  formatDay,
  formatMoment,
  formatSpan,
  type Inspection,
  type PlannedWork,
  type RequestStatus,
  type ServiceRequest,
} from '@domovoy/domain';

import type { Language, Translate } from '@domovoy/i18n';

import type { NoticeKind } from '@domovoy/domain';

import { counted, speakDefault } from './language.js';
import type { Resident } from './repository.js';
import { withOriginal } from './translation.js';
import { formatMomentAt } from './zone.js';

/** Действие, доступное получателю прямо из уведомления. */
export interface NotificationAction {
  requestId: string;
  /** Из какого состояния идёт переход: от него зависит подпись кнопки. */
  from: RequestStatus;
  to: RequestStatus;
  /** Переход требует объяснения: канал обязан сначала спросить причину. */
  requiresComment: boolean;
}

export interface Notification {
  /** Кому: идентификатор пользователя MAX, а не внутренний. */
  maxUserId: number;
  text: string;
  /** Язык получателя: на нём идут подписи кнопок под сообщением. */
  language?: Language;
  /** Что получатель может сделать в ответ, не открывая приложение. */
  actions?: NotificationAction[];
  /** Заявка, по которой можно ответить прямо в чате. */
  replyTo?: string;
  /** Заявка, по которой у соседа спрашивают, то же ли самое у него. */
  askAbout?: string;
  /** Предложение соседа: его поддерживают кнопкой под сообщением. */
  signAbout?: string;
  /** Обращение в поддержку: на него отвечают кнопкой под сообщением. */
  answerAbout?: string;
  /** Раздел приложения, в котором уведомление продолжается: туда ведёт кнопка. */
  section?: string;
  /** Такие уведомления можно отключить прямо отсюда. */
  mutable?: NoticeKind;
  /** По этой заявке уже есть основание для жалобы в жилинспекцию. */
  complaintFor?: string;
  /** Собрание, по которому голосуют кнопками прямо под уведомлением. */
  voteAbout?: string;
}

/** Файл в переписку с человеком: наклейка, выгрузка, документ. */
export interface OutgoingFile {
  maxUserId: number;
  /** Картинку смотрят в ленте, файл сохраняют к себе. */
  as: 'image' | 'document';
  name: string;
  contentType: string;
  content: string;
  encoding: 'utf8' | 'base64';
  text?: string;
}

/** Канал доставки уведомлений. */
export interface Notifier {
  send(notification: Notification): Promise<void>;
  /** Файл человеку. Возвращает идентификатор сообщения: по нему его пересылают. */
  sendFile?(file: OutgoingFile): Promise<string | undefined>;
  /** Куда сообщить о неудачной доставке. Отказ канала не отменяет уже сделанное. */
  onError?(error: unknown): void;
  /** Сообщение в чат дома. Возвращает его идентификатор. */
  sendToChat?(chatId: number, text: string): Promise<string | undefined>;
  /** Закрепить сообщение в чате. */
  pinInChat?(chatId: number, messageId: string): Promise<void>;
  unpinInChat?(chatId: number): Promise<void>;
}

/** Уведомления выключены: подходит для тестов API и запуска без бота. */
export const noopNotifier: Notifier = {
  async send() {
    /* никуда не отправляем */
  },
};

/** Собирает уведомления вместо отправки. */
export const createCollectingNotifier = (): Notifier & {
  sent: Notification[];
  files: OutgoingFile[];
  posted: { chatId: number; text: string }[];
  pinned: { chatId: number; messageId: string }[];
  unpinned: number[];
} => {
  const sent: Notification[] = [];
  const files: OutgoingFile[] = [];
  const posted: { chatId: number; text: string }[] = [];
  const pinned: { chatId: number; messageId: string }[] = [];
  const unpinned: number[] = [];

  return {
    sent,
    files,
    posted,
    pinned,
    unpinned,
    async send(notification) {
      sent.push(notification);
    },
    async sendFile(file) {
      files.push(file);
      return `mid-file-${files.length}`;
    },
    async sendToChat(chatId, text) {
      posted.push({ chatId, text });
      return `mid-${posted.length}`;
    },
    async pinInChat(chatId, messageId) {
      pinned.push({ chatId, messageId });
    },
    async unpinInChat(chatId) {
      unpinned.push(chatId);
    },
  };
};

/** Язык продукта: им говорят со сменой и с домовым чатом. */
const RU = speakDefault();

/**
 * Где случилось: категория и объект. Категорию опускаем, когда объект её уже
 * называет, иначе выходит «Лифт, Лифт, подъезд 2». Совпадение сверяется по
 * русскому названию: объект приходит из справочника дома на одном языке.
 */
export const describePlace = (request: ServiceRequest, t: Translate = RU): string => {
  const category = CATEGORY_RULES[request.category].title;
  const target = describeTarget(request.target);
  const told = request.category === 'other' || target.toLowerCase().startsWith(category.toLowerCase());

  return told ? target : `${t(categoryKey(request.category))}, ${target}`;
};

/** Состояния заявки словами жильца: ему важно, что ждут от него. */
const STATUS_KEYS: Record<string, string> = {
  accepted: 'app.notice.statusOf.accepted',
  in_progress: 'app.notice.statusOf.in_progress',
  needs_info: 'app.notice.statusOf.needs_info',
  done: 'app.notice.statusOf.done',
  confirmed: 'app.notice.statusOf.confirmed',
  rejected: 'app.notice.statusOf.rejected',
  withdrawn: 'app.notice.statusOf.withdrawn',
};

/** Текст уведомления о смене статуса. */
export const formatStatusChange = (t: Translate, request: ServiceRequest): string => {
  const key = STATUS_KEYS[request.status];
  const status = key ? t(key) : request.status;
  const last = request.history.at(-1);
  const comment = last?.comment ? `\n${last.comment}` : '';

  return (
    t('app.notice.status', {
      номер: request.number,
      состояние: status,
      суть: request.title,
      место: describePlace(request, t),
    }) + comment
  );
};

/** Наряд исполнителю. */
export const formatAssignment = (request: ServiceRequest, timeZone?: string): string => {
  const due = formatMomentAt(request.resolutionDueAt, timeZone);

  return (
    `Вам поручена заявка ${request.number}.\n${request.title}\n` +
    `${describePlace(request)}. Срок: ${due}.`
  );
};

/** Сообщение в переписке по заявке: кто написал, видно по подписи отправителя. */
export const formatMessage = (t: Translate, request: ServiceRequest, author: string, text: string): string =>
  t('app.notice.message', { номер: request.number, автор: author, текст: text });

/** Адрес дописывается тем, у кого домов больше одного. */
export const formatAnnouncement = (title: string, body: string, house?: string): string =>
  `${title}${house ? `\n${house}` : ''}\n\n${body}`;

/** Рассылка: получатель должен видеть, что пишет управляющая компания, а не бот. */
export const formatBroadcast = (t: Translate, text: string, house?: string): string =>
  `${t('app.notice.broadcast', { дом: house ? `, ${house}` : '' })}\n\n${text}`;

/** Назначенный обход: мастер узнаёт о нём так же, как о наряде. */
export const formatInspection = (inspection: Inspection): string => {
  const where = inspection.entrance === undefined ? 'весь дом' : `подъезд ${inspection.entrance}`;
  return `${INSPECTION_RULES[inspection.kind].title}: ${where}, до ${formatDay(inspection.dueAt)}.\nПункты обхода в приложении.`;
};

/** Гость вошёл по выданному коду. */
export const formatGuestEntry = (t: Translate, device: string, at: Date): string =>
  t('app.notice.guestEntry', { устройство: device, время: formatClock(at) });

/** Сколько знаков описания входит в уведомление: остальное читают в карточке. */
export const DESCRIPTION_IN_NOTICE = 300;

/** Описание не длиннее {@link DESCRIPTION_IN_NOTICE}: лишнее отрезается по слову. */
const shortened = (text: string): string => {
  if (text.length <= DESCRIPTION_IN_NOTICE) return text;

  const cut = text.slice(0, DESCRIPTION_IN_NOTICE);
  const lastSpace = cut.lastIndexOf(' ');

  return `${(lastSpace > DESCRIPTION_IN_NOTICE / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

/** Новая заявка для диспетчера. */
export const formatNewRequest = (request: ServiceRequest, reporters: number): string => {
  const urgent = request.priority === 'emergency' ? 'АВАРИЯ. ' : '';
  const confirmed = reporters > 1 ? `\nСообщили: ${reporters}` : '';

  // Смена читает перевод, а под ним, то, что человек написал своими словами.
  const original = request.original
    ? { ...request.original, text: shortened(request.original.text) }
    : undefined;

  return (
    `${urgent}Новая заявка: ${request.title}\n` +
    `${describePlace(request)} · ${request.number}\n` +
    `${withOriginal(shortened(request.description), original)}${confirmed}`
  );
};

/** Вопрос соседям, когда сообщила одна квартира. */
export const formatNeighbourQuestion = (t: Translate, request: ServiceRequest): string =>
  t('app.notice.neighbourQuestion', { суть: request.title.toLowerCase(), номер: request.number });

/** Стук к соседу сверху: без номера квартиры и имени того, у кого течёт. */
export const formatKnock = (t: Translate, request: ServiceRequest): string =>
  t('app.notice.knock', { суть: request.title.toLowerCase() });

export const formatNeighbourAlert = (t: Translate, request: ServiceRequest, dueAt: Date): string =>
  t('app.notice.neighbourAlert', {
    категория: t(categoryKey(request.category)).toLowerCase(),
    место: describeTarget(request.target),
    номер: request.number,
    срок: formatMoment(dueAt),
  });

/** Сообщение о нарушенном сроке. */
export const formatOverdue = (
  t: Translate,
  request: ServiceRequest,
  kind: 'reaction' | 'resolution',
  canEscalate: boolean,
): string =>
  t('app.notice.overdue', {
    номер: request.number,
    что: t(`app.notice.overdueOf.${kind}`),
    место: describeTarget(request.target),
    дальше: canEscalate ? t('app.notice.overdueEscalate') : t('app.notice.overdueWait'),
  });

/** Работы завтра. */
export const formatWorksSoon = (t: Translate, work: PlannedWork, now: Date): string =>
  t('app.notice.worksSoon', {
    категория: t(categoryKey(work.category)).toLowerCase(),
    адресаты: describeAudience(work.audience),
    до: describeUntil(work, now),
    название: work.title,
  });

/** Работы начались. */
export const formatWorksStarted = (t: Translate, work: PlannedWork, now: Date): string =>
  t('app.notice.worksStarted', {
    категория: t(categoryKey(work.category)).toLowerCase(),
    название: work.title,
    адресаты: describeAudience(work.audience),
    до: describeUntil(work, now),
  });

/** Работы закончились по графику. */
export const formatWorksFinished = (t: Translate, work: PlannedWork): string =>
  t('app.notice.worksFinished', { название: work.title, адресаты: describeAudience(work.audience) });

/** Напоминание жильцу о приёмке работы. */
export const formatAcceptanceReminder = (t: Translate, request: ServiceRequest, hoursLeft: number): string =>
  t('app.notice.acceptance', {
    номер: request.number,
    место: describePlace(request, t),
    часы: counted(t, 'hours', hoursLeft),
  });

/** Заявка закрылась без ответа жильца. */
export const formatAutoConfirmed = (t: Translate, request: ServiceRequest, hours: number): string =>
  t('app.notice.autoConfirmed', {
    номер: request.number,
    часы: counted(t, 'hours', hours),
    место: describePlace(request, t),
  });

/** Предупреждение сотруднику: срок вот-вот сгорит. */
export const formatDeadlineWarning = (
  request: ServiceRequest,
  kind: 'reaction' | 'resolution',
  now: Date,
): string => {
  const due = kind === 'reaction' ? request.reactionDueAt : request.resolutionDueAt;
  const left = formatSpan(now, due);

  const what = kind === 'reaction' ? 'заявка не принята в работу' : 'работы не завершены';

  return (
    `Срок горит: ${request.number}, ${what}.\n` +
    `${describePlace(request)}.\n` +
    `Осталось ${left}.`
  );
};

/** Сообщение управляющей компании о нарушенном нормативе. */
export const formatBreachForStaff = (request: ServiceRequest, kind: 'reaction' | 'resolution'): string => {
  const what = kind === 'reaction' ? 'нарушен срок реакции' : 'нарушен срок выполнения';

  return (
    `Норматив нарушен: ${request.number}, ${what}.\n` +
    `${describePlace(request)}.\n` +
    'Жильцы уведомлены и вправе обратиться в жилищную инспекцию.'
  );
};

/** Что получатель может сделать с заявкой прямо из уведомления. */
export const actionsFor = (request: ServiceRequest, resident: Resident): NotificationAction[] =>
  allowedTransitions(request.status, resident.role, request.assigneeId === resident.id).map((to) => ({
    requestId: request.id,
    from: request.status,
    to,
    requiresComment: findTransition(request.status, to, resident.role)?.requiresComment ?? false,
  }));

/**
 * Доставка уведомления. Отказ канала не выбрасывается наружу: действие,
 * из-за которого шло уведомление, уже выполнено.
 */
const deliver = async (notifier: Notifier, notification: Notification): Promise<void> => {
  try {
    await notifier.send(notification);
  } catch (error) {
    notifier.onError?.(error);
  }
};

/** Что предложить под уведомлением: переход в приложение, отказ, готовую жалобу. */
export interface NoticeAbout {
  /** Раздел приложения, в котором уведомление продолжается. */
  section?: string;
  /** Вид уведомления: его отключают кнопкой, не заходя в настройки. */
  mutable?: NoticeKind;
  /** Заявка, по которой можно составить обращение в жилинспекцию. */
  complaintFor?: string;
  /** Собрание: бюллетень идёт кнопками под самим уведомлением. */
  voteAbout?: string;
}

/**
 * Уведомление, которое продолжается в приложении: под ним стоит кнопка перехода
 * в нужный раздел, а у отключаемых, ещё и отказ от таких сообщений.
 */
export const notifyAbout = async (
  notifier: Notifier,
  resident: Resident | undefined,
  text: string,
  about: NoticeAbout,
): Promise<void> => {
  if (!resident?.maxUserId) return;

  await deliver(notifier, {
    maxUserId: resident.maxUserId,
    text,
    ...(resident.language ? { language: resident.language } : {}),
    ...(about.section ? { section: about.section } : {}),
    ...(about.mutable ? { mutable: about.mutable } : {}),
    ...(about.complaintFor ? { complaintFor: about.complaintFor } : {}),
    ...(about.voteAbout ? { voteAbout: about.voteAbout } : {}),
  });
};

/** На что получатель отвечает кнопкой под сообщением. */
export interface NotifyReply {
  /** Заявка, по которой отвечают прямо в переписке. */
  replyTo?: string;
  /** Заявка, по которой у соседа спрашивают, то же ли самое у него. */
  askAbout?: string;
  /** Предложение соседа: его поддерживают кнопкой. */
  signAbout?: string;
  /** Обращение в поддержку: на него отвечают кнопкой. */
  answerAbout?: string;
  /** Раздел, о котором говорит уведомление: в него и ведёт кнопка под текстом. */
  section?: string;
}

/**
 * Отправляет уведомление, если у получателя есть идентификатор в MAX.
 * Строкой в `reply` передаётся заявка для ответа: так вызывает часть кода.
 */
export const notifyResident = async (
  notifier: Notifier,
  resident: Resident | undefined,
  text: string,
  actions: NotificationAction[] = [],
  reply: NotifyReply | string = {},
): Promise<void> => {
  if (!resident?.maxUserId) return;

  const { replyTo, askAbout, signAbout, answerAbout, section }: NotifyReply =
    typeof reply === 'string' ? { replyTo: reply } : reply;

  await deliver(notifier, {
    maxUserId: resident.maxUserId,
    text,
    ...(resident.language ? { language: resident.language } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(askAbout ? { askAbout } : {}),
    ...(signAbout ? { signAbout } : {}),
    ...(answerAbout ? { answerAbout } : {}),
    ...(section ? { section } : {}),
  });
};
