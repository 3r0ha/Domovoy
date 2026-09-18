import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Chaos } from './chaos.js';
import { handleRequest, type MockResponse } from './handler.js';
import {
  PlatformState,
  type MockUpdate,
  type MockUser,
  type RequestLogEntry,
  type SentAnswer,
  type SentMessage,
} from './state.js';

export interface MockPlatformOptions {
  /** Ожидаемый токен. По умолчанию принимается любой непустой. */
  token?: string | null;
  bot?: Partial<MockUser>;
  host?: string;
  port?: number;
  /** Потолок ожидания в долгом опросе. */
  maxPollTimeoutMs?: number;
  /** Доставлять ли апдейты на подписанные вебхуки. */
  deliverWebhooks?: boolean;
  now?: () => number;
}

/** Где идёт разговор: переписка с ботом, общий чат или канал. */
export type ChatType = 'dialog' | 'chat' | 'channel';

export interface ActorOptions {
  userId?: number;
  chatId?: number;
  firstName?: string;
  username?: string;
}

export interface ChatMessageOptions extends ActorOptions {
  /** Сообщение начинается с упоминания бота. */
  mention?: boolean;
  /** Сообщение отправлено ответом на эту реплику. */
  quote?: string;
  quoteFrom?: number;
  quoteFromBot?: boolean;
}

export interface ChatEventOptions extends ActorOptions {
  isChannel?: boolean;
  isBot?: boolean;
}

const DEFAULT_BOT: MockUser = {
  user_id: 1,
  first_name: 'MaxKit Bot',
  username: 'maxkit_test_bot',
  is_bot: true,
};

const DEFAULT_ACTOR = { userId: 1001, chatId: 2001, firstName: 'Жилец', username: 'zhilec' };

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);

  if (chunks.length === 0) return undefined;

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
};

const send = (response: ServerResponse, result: MockResponse): void => {
  response.writeHead(result.status, {
    'content-type': 'application/json; charset=utf-8',
    ...result.headers,
  });
  response.end(JSON.stringify(result.body));
};

/** Локальная замена `platform-api2.max.ru`. */
export class MockPlatform {
  readonly chaos = new Chaos();
  readonly state: PlatformState;

  private readonly options: Required<Omit<MockPlatformOptions, 'bot' | 'token'>> & {
    token: string | null;
    bot: MockUser;
  };
  private server: Server | null = null;
  private address: { host: string; port: number } | null = null;

  constructor(options: MockPlatformOptions = {}) {
    const bot: MockUser = { ...DEFAULT_BOT, ...options.bot };

    this.options = {
      token: options.token ?? null,
      bot,
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 0,
      maxPollTimeoutMs: options.maxPollTimeoutMs ?? 30_000,
      deliverWebhooks: options.deliverWebhooks ?? true,
      now: options.now ?? Date.now,
    };

    this.state = new PlatformState(bot, this.options.now);
  }

  /** Базовый адрес: подставляется в `baseUrl` клиента вместо адреса платформы. */
  get url(): string {
    if (!this.address) throw new Error('MockPlatform: сервер не запущен');
    return `http://${this.address.host}:${this.address.port}`;
  }

  get outgoing(): readonly SentMessage[] {
    return this.state.outgoing;
  }

  get requests(): readonly RequestLogEntry[] {
    return this.state.requests;
  }

  /** Ответы на нажатия кнопок: из них видно всплывающие уведомления. */
  get answers(): readonly SentAnswer[] {
    return this.state.answers;
  }

  async start(): Promise<this> {
    if (this.server) return this;

    const server = createServer((request, response) => void this.dispatch(request, response));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    const address = server.address() as AddressInfo;
    this.address = { host: this.options.host, port: address.port };

    return this;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;

    this.server = null;
    this.address = null;
    this.state.releaseWaiters();

    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Пользователь пишет боту. */
  userSends(text: string, actor: ActorOptions = {}): MockUpdate {
    const { userId, chatId, firstName, username } = { ...DEFAULT_ACTOR, ...actor };

    return this.pushUpdate({
      update_type: 'message_created',
      timestamp: this.options.now(),
      message: {
        sender: { user_id: userId, first_name: firstName, username, is_bot: false },
        recipient: { chat_id: chatId, chat_type: 'dialog', user_id: userId },
        timestamp: this.options.now(),
        body: { mid: `mid.in.${this.state.nextMarker}`, seq: this.state.nextMarker, text, attachments: [] },
      },
    });
  }

  /** Пользователь нажимает кнопку с payload. */
  userPressesButton(payload: string, actor: ActorOptions & { chatType?: ChatType } = {}): MockUpdate {
    const { userId, chatId, firstName, username } = { ...DEFAULT_ACTOR, ...actor };
    const chatType = actor.chatType ?? 'dialog';
    const callbackId = `cb-${this.state.nextMarker}`;

    // Кнопка стоит под последним сообщением бота в этой переписке: ответом
    // на нажатие его и правят, поэтому нажатие с ним и связывается.
    const under = [...this.state.outgoing].reverse().find((message) => message.chatId === chatId);

    if (under) this.state.bindPress(callbackId, under.mid);

    return this.pushUpdate({
      update_type: 'message_callback',
      timestamp: this.options.now(),
      callback: {
        timestamp: this.options.now(),
        callback_id: callbackId,
        payload,
        user: { user_id: userId, first_name: firstName, username, is_bot: false },
      },
      message: {
        recipient: { chat_id: chatId, chat_type: chatType, user_id: chatType === 'dialog' ? userId : null },
        body: {
          mid: under?.mid ?? `mid.cb.${this.state.nextMarker}`,
          seq: this.state.nextMarker,
          text: under?.text ?? '',
          attachments: [],
        },
      },
    });
  }

  /** Сообщение в общем чате: бот в нём один из участников. */
  chatSends(text: string, options: ChatMessageOptions = {}): MockUpdate {
    const { userId, chatId, firstName, username } = { ...DEFAULT_ACTOR, ...options };
    const mention = options.mention ? `@${this.state.bot.username ?? 'bot'} ` : '';
    const quoted = options.quote;

    return this.pushUpdate({
      update_type: 'message_created',
      timestamp: this.options.now(),
      message: {
        sender: { user_id: userId, first_name: firstName, username, is_bot: false },
        recipient: { chat_id: chatId, chat_type: 'chat', user_id: null },
        timestamp: this.options.now(),
        ...(quoted
          ? {
              link: {
                type: 'reply',
                sender: {
                  user_id: options.quoteFrom ?? userId + 1,
                  first_name: 'Сосед',
                  is_bot: options.quoteFromBot ?? false,
                },
                message: { mid: `mid.quoted.${this.state.nextMarker}`, seq: 0, text: quoted },
              },
            }
          : {}),
        body: {
          mid: `mid.in.${this.state.nextMarker}`,
          seq: this.state.nextMarker,
          text: `${mention}${text}`,
          attachments: [],
          ...(options.mention
            ? {
                markup: [
                  {
                    type: 'user_mention',
                    from: 0,
                    length: mention.length - 1,
                    user_id: this.state.bot.user_id,
                  },
                ],
              }
            : {}),
        },
      },
    });
  }

  /** Комментарий под постом канала. */
  channelComments(text: string, options: ChatMessageOptions & { postId?: string } = {}): MockUpdate {
    const { userId, chatId, firstName, username } = { ...DEFAULT_ACTOR, ...options };
    const mention = options.mention ? `@${this.state.bot.username ?? 'bot'} ` : '';
    const post = options.postId ?? 'mid.post.1';

    return this.pushUpdate({
      update_type: 'comment_created',
      timestamp: this.options.now(),
      message: {
        sender: { user_id: userId, first_name: firstName, username, is_bot: false },
        recipient: { chat_id: chatId, chat_type: 'channel', user_id: null, post_id: post },
        timestamp: this.options.now(),
        body: {
          mid: `mid.comment.${this.state.nextMarker}`,
          seq: this.state.nextMarker,
          text: `${mention}${text}`,
          attachments: [],
          ...(options.mention
            ? {
                markup: [
                  { type: 'user_mention', from: 0, length: mention.length - 1, user_id: this.state.bot.user_id },
                ],
              }
            : {}),
        },
      },
    });
  }

  /** Бота добавили в чат. */
  botAdded(options: ChatEventOptions = {}): MockUpdate {
    return this.chatEvent('bot_added', options);
  }

  /** Бота удалили из чата. */
  botRemoved(options: ChatEventOptions = {}): MockUpdate {
    return this.chatEvent('bot_removed', options);
  }

  /** В чат вошёл новый участник. */
  userAdded(options: ChatEventOptions = {}): MockUpdate {
    return this.chatEvent('user_added', options);
  }

  private chatEvent(type: string, options: ChatEventOptions): MockUpdate {
    const { userId, chatId, firstName, username } = { ...DEFAULT_ACTOR, ...options };

    return this.pushUpdate({
      update_type: type,
      timestamp: this.options.now(),
      chat_id: chatId,
      user: { user_id: userId, first_name: firstName, username, is_bot: options.isBot ?? false },
      is_channel: options.isChannel ?? false,
    });
  }

  /** Что закреплено в чате. */
  pinnedIn(chatId: number): string | undefined {
    return this.state.pinned.get(chatId)?.messageId;
  }

  /** Закрепление, сделанное не ботом. */
  setPinned(chatId: number, messageId: string, senderId: number): void {
    this.state.pinned.set(chatId, { messageId, senderId });
  }

  /** Права бота в чате: `null`, платформа их не сообщает. */
  setBotPermissions(permissions: string[] | null): void {
    this.state.botPermissions = permissions;
  }

  /** Пользователь запускает бота. */
  botStarted(actor: ActorOptions = {}): MockUpdate {
    const { userId, chatId, firstName, username } = { ...DEFAULT_ACTOR, ...actor };

    return this.pushUpdate({
      update_type: 'bot_started',
      timestamp: this.options.now(),
      chat_id: chatId,
      user: { user_id: userId, first_name: firstName, username, is_bot: false },
    });
  }

  pushUpdate(update: MockUpdate): MockUpdate {
    const stored = this.state.pushUpdate(update);
    if (this.options.deliverWebhooks) void this.deliverToWebhooks(stored);
    return stored;
  }

  /** Ждёт ответа на нажатие кнопки: всплывающее уведомление приходит им. */
  async waitForAnswers(count: number, timeoutMs = 2000): Promise<readonly SentAnswer[]> {
    const deadline = Date.now() + timeoutMs;

    while (this.state.answers.length < count) {
      if (Date.now() > deadline) {
        throw new Error(
          `MockPlatform: бот ответил на ${this.state.answers.length} нажатий из ожидаемых ${count} за ${timeoutMs} мс`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return this.state.answers.slice(0, count);
  }

  /** Ждёт, пока бот отправит указанное количество сообщений. */
  async waitForOutgoing(count: number, timeoutMs = 2000): Promise<readonly SentMessage[]> {
    const deadline = Date.now() + timeoutMs;

    while (this.state.outgoing.length < count) {
      if (Date.now() > deadline) {
        throw new Error(
          `MockPlatform: бот отправил ${this.state.outgoing.length} сообщений из ожидаемых ${count} за ${timeoutMs} мс`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return this.state.outgoing.slice(0, count);
  }

  reset(): void {
    this.state.reset();
    this.chaos.reset();
  }

  /** Забыть уже отправленное: дальше тест смотрит только на новые сообщения. */
  forgetOutgoing(): void {
    this.state.forgetOutgoing();
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/^\/+/, '');

    const fault = this.chaos.take(path);

    if (fault?.kind === 'abort') {
      request.socket.destroy();
      return;
    }

    if (fault?.kind === 'hang') {
      return;
    }

    if (fault?.kind === 'delay') {
      await new Promise((resolve) => setTimeout(resolve, fault.ms));
    }

    if (fault?.kind === 'status') {
      send(response, { status: fault.status, body: fault.body ?? {}, ...(fault.headers ? { headers: fault.headers } : {}) });
      return;
    }

    const body = await readBody(request);
    const authorization = request.headers['authorization'];

    const result = await handleRequest(
      this.state,
      {
        method: request.method ?? 'GET',
        path,
        query: Object.fromEntries(url.searchParams),
        body,
        token: typeof authorization === 'string' ? authorization : null,
      },
      {
        expectedToken: this.options.token,
        baseUrl: this.url,
        maxPollTimeoutMs: this.options.maxPollTimeoutMs,
        now: this.options.now,
      },
    );

    if (response.writableEnded || response.destroyed) return;
    send(response, result);
  }

  private async deliverToWebhooks(update: MockUpdate): Promise<void> {
    for (const subscription of this.state.subscriptions) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (subscription.secret) headers['x-max-bot-api-secret'] = subscription.secret;

      try {
        await fetch(subscription.url, { method: 'POST', headers, body: JSON.stringify(update) });
      } catch {
        continue;
      }
    }
  }
}

/** Запускает эмулятор и возвращает готовый к работе экземпляр. */
export const startMockPlatform = (options: MockPlatformOptions = {}): Promise<MockPlatform> =>
  new MockPlatform(options).start();
