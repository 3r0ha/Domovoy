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
    return sent;
  }

  log(entry: RequestLogEntry): void {
    this.requests.push(entry);
  }

  /** Сообщения, отправленные до этого момента, из истории убираются. */
  forgetOutgoing(): void {
    this.outgoing.length = 0;
  }

  reset(): void {
    this.updates.length = 0;
    this.outgoing.length = 0;
    this.answers.length = 0;
    this.uploads.length = 0;
    this.requests.length = 0;
    this.subscriptions.length = 0;
    this.pinned.clear();
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
