export interface MockUser {
  user_id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  is_bot: boolean;
}

export interface MockUpdate {
  update_type: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface SentMessage {
  /** Кому ушло сообщение: чат или пользователь. */
  chatId?: number;
  userId?: number;
  /** Пост канала, если это комментарий под ним. */
  postId?: string;
  text: string;
  attachments: unknown[];
  body: Record<string, unknown>;
  mid: string;
  at: number;
}

/** Ответ на нажатие кнопки: всплывающее уведомление и правка сообщения. */
export interface SentAnswer {
  callbackId: string;
  notification?: string;
  body: Record<string, unknown>;
  at: number;
}

export interface RequestLogEntry {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  at: number;
}

export interface Subscription {
  url: string;
  secret?: string;
  update_types?: string[];
}

interface Waiter {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Что бот умеет в чате по умолчанию: писать и закреплять. */
const DEFAULT_PERMISSIONS = ['write', 'pin_message'];

/** Состояние эмулятора: апдейты с маркерами, сообщения, подписки и журнал запросов. */
export class PlatformState {
  readonly updates: MockUpdate[] = [];
  readonly outgoing: SentMessage[] = [];
  /** Ответы на нажатия кнопок: всплывающие уведомления видно только здесь. */
  readonly answers: SentAnswer[] = [];
  /** Что бот загружал на платформу: наклейки и снимки. */
  readonly uploads: { type: string }[] = [];
  readonly requests: RequestLogEntry[] = [];
  readonly subscriptions: Subscription[] = [];
  /** Закреплённое сообщение по чатам: кто закрепил, видно по отправителю. */
  readonly pinned = new Map<number, { messageId: string; senderId: number }>();

  /** Сообщения, которые бот убрал из переписки: для прогонов они не пропадают. */
  readonly deleted: SentMessage[] = [];

  /** Нажатие: переписка и сообщение, под которым стояла кнопка. Ответ правит его. */
  readonly pressed = new Map<string, { chatId?: number; mid?: string }>();
  /** Права бота в чате. `null`, платформа их не сообщает. */
  botPermissions: string[] | null = [...DEFAULT_PERMISSIONS];

  private readonly waiters = new Set<Waiter>();
  private messageCounter = 0;

  constructor(
    readonly bot: MockUser,
    private readonly now: () => number = Date.now,
  ) {}

  /** Номер, который получит следующий апдейт. */
  get nextMarker(): number {
    return this.updates.length + 1;
  }

  pushUpdate(update: MockUpdate): MockUpdate {
    this.updates.push(update);
    this.wakeWaiters();
    return update;
  }

  /** Апдейты начиная с маркера. Маркер `undefined` означает «всё, что есть». */
  read(marker: number | undefined, limit: number): { updates: MockUpdate[]; marker: number } {
    const from = marker === undefined ? 1 : Math.max(1, marker);
    const slice = this.updates.slice(from - 1, from - 1 + limit);

    return { updates: slice, marker: from + slice.length };
  }

  /** Ждёт появления апдейтов после указанной позиции. */
  async waitForUpdates(marker: number, timeoutMs: number): Promise<void> {
    if (this.updates.length >= marker) return;
    if (timeoutMs <= 0) return;

    await new Promise<void>((resolve) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve();
        }, timeoutMs),
      };

      this.waiters.add(waiter);
    });
  }

  recordSent(message: Omit<SentMessage, 'mid' | 'at'>): SentMessage {
    this.messageCounter += 1;
    const sent: SentMessage = {
      ...message,
      mid: `mid.${this.messageCounter.toString(16).padStart(32, '0')}`,
      at: this.now(),
    };

    this.outgoing.push(sent);
    return sent;
  }

  recordAnswer(answer: Omit<SentAnswer, 'at'>): SentAnswer {
    const sent: SentAnswer = { ...answer, at: this.now() };

    this.answers.push(sent);

    // Ответ с сообщением переписывает то, под которым стояла кнопка: так это
    // работает на платформе, и история переписки от нажатий не растёт.
    const press = this.pressed.get(sent.callbackId);
    const replacement = sent.body['message'] as Record<string, unknown> | undefined;

    if (!replacement) return sent;

    const target = press?.mid ? this.outgoing.find((message) => message.mid === press.mid) : undefined;

    if (target) {
      if (typeof replacement['text'] === 'string') target.text = replacement['text'];
      if (Array.isArray(replacement['attachments'])) target.attachments = replacement['attachments'];

      target.body = { ...target.body, ...replacement };

      return sent;
    }

    // Править нечего: на платформе у кнопки всегда есть своё сообщение,
    // а в прогоне нажатие может быть первым. Тогда ответ виден новым.
    this.recordSent({
      ...(press?.chatId === undefined ? {} : { chatId: press.chatId }),
      text: typeof replacement['text'] === 'string' ? replacement['text'] : '',
      attachments: Array.isArray(replacement['attachments']) ? replacement['attachments'] : [],
      body: replacement,
    });

    return sent;
  }

  /** Удаление сообщения: бот убирает своё, и в переписке его больше нет. */
  forgetMessage(mid: string): void {
    const at = this.outgoing.findIndex((message) => message.mid === mid);

    if (at < 0) return;

    const [gone] = this.outgoing.splice(at, 1);

    if (gone) this.deleted.push(gone);
  }

  /** Сколько бот отправил всего, вместе с тем, что потом убрал. */
  get sentCount(): number {
    return this.outgoing.length + this.deleted.length;
  }

  /** Под каким сообщением стояла нажатая кнопка и в какой переписке. */
  bindPress(callbackId: string, press: { chatId?: number; mid?: string }): void {
    this.pressed.set(callbackId, press);
  }

  log(entry: RequestLogEntry): void {
    this.requests.push(entry);
  }

  /** Сообщения, отправленные до этого момента, из истории убираются. */
  forgetOutgoing(): void {
    this.outgoing.length = 0;
    this.deleted.length = 0;
  }

  reset(): void {
    this.updates.length = 0;
    this.outgoing.length = 0;
    this.deleted.length = 0;
    this.answers.length = 0;
    this.uploads.length = 0;
    this.requests.length = 0;
    this.subscriptions.length = 0;
    this.pinned.clear();
    this.pressed.clear();
    this.botPermissions = [...DEFAULT_PERMISSIONS];
    this.messageCounter = 0;
    this.wakeWaiters();
  }

  /** Снимает всех ожидающих: вызывается при остановке сервера. */
  releaseWaiters(): void {
    this.wakeWaiters();
  }

  private wakeWaiters(): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.waiters.clear();
  }
}
