import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { OrderedScheduler } from './scheduler.js';
import { defaultOrderingKey, type UpdateLike } from './supervisor.js';

export const BOT_API_SECRET_HEADER = 'x-max-bot-api-secret';

export interface DedupeOptions {
  /** Сколько времени помнить уже принятые апдейты. */
  ttlMs?: number;
  /** Потолок числа запомненных ключей. */
  max?: number;
  /** Ключ апдейта. По умолчанию, тип, время и идентификатор сообщения. */
  key?: (update: UpdateLike) => string;
}

export interface WebhookReceiverOptions {
  handleUpdate: (update: UpdateLike) => Promise<void>;
  /** Секрет, который платформа присылает в заголовке `X-Max-Bot-Api-Secret`. */
  secret: string;
  /** Сколько апдейтов обрабатывается одновременно. */
  concurrency?: number;
  /** Ключ упорядочивания. По умолчанию, чат апдейта. */
  orderingKey?: (update: UpdateLike) => string;
  /** Предел размера тела запроса. */
  maxBodyBytes?: number;
  /** Отсев повторной доставки. `false` отключает. */
  dedupe?: DedupeOptions | false;
  onHandlerError?: (error: unknown, update: UpdateLike) => void;
  now?: () => number;
}

export interface WebhookResult {
  status: number;
  body: string;
}

export interface WebhookStats {
  accepted: number;
  processed: number;
  failed: number;
  rejected: number;
  duplicates: number;
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_DEDUPE_MAX = 10_000;

/** Идентификатором может быть только строка или число: объект превратился бы в общий для всех ключ. */
const asIdentity = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const defaultDedupeKey = (update: UpdateLike): string => {
  const messageBody = (update['message'] as { body?: { mid?: unknown } } | undefined)?.body;
  const callbackId = (update['callback'] as { callback_id?: unknown } | undefined)?.callback_id;

  const identity =
    asIdentity(messageBody?.mid) ?? asIdentity(callbackId) ?? asIdentity(update.timestamp) ?? '';

  return `${update.update_type}:${identity}`;
};

/** Небольшой кеш ключей со сроком жизни: защита от повторной доставки. */
class SeenKeys {
  private readonly entries = new Map<string, number>();
  private nextSweepAt = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
    private readonly now: () => number,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** @returns `true`, если ключ встречается впервые. */
  add(key: string): boolean {
    const now = this.now();
    const seenAt = this.entries.get(key);

    if (seenAt !== undefined && now - seenAt < this.ttlMs) return false;

    this.entries.set(key, now);
    if (this.entries.size > this.max || now >= this.nextSweepAt) this.sweep(now);

    return true;
  }

  private sweep(now: number): void {
    for (const [key, seenAt] of this.entries) {
      if (now - seenAt >= this.ttlMs) this.entries.delete(key);
    }

    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }

    this.nextSweepAt = now + this.ttlMs;
  }
}

/** Приём апдейтов по вебхуку с теми же гарантиями, что и при опросе. */
export class WebhookReceiver {
  private readonly scheduler: OrderedScheduler;
  private readonly orderingKey: (update: UpdateLike) => string;
  private readonly secret: Buffer;
  private readonly maxBodyBytes: number;
  private readonly seen: SeenKeys | null;
  private readonly dedupeKey: (update: UpdateLike) => string;
  private readonly counters: WebhookStats = { accepted: 0, processed: 0, failed: 0, rejected: 0, duplicates: 0 };

  constructor(private readonly options: WebhookReceiverOptions) {
    if (!options.secret) throw new Error('WebhookReceiver: секрет обязателен');

    if (!/^[\x21-\x7e]+$/.test(options.secret)) {
      throw new Error(
        'WebhookReceiver: секрет должен состоять из печатаемых символов ASCII без пробелов, ' +
          'иначе он не переживёт передачу в HTTP-заголовке',
      );
    }

    this.scheduler = new OrderedScheduler(options.concurrency ?? 16);
    this.orderingKey = options.orderingKey ?? defaultOrderingKey;
    this.secret = Buffer.from(options.secret);
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

    const now = options.now ?? Date.now;
    const dedupe = options.dedupe ?? {};
    this.seen =
      dedupe === false
        ? null
        : new SeenKeys(dedupe.ttlMs ?? DEFAULT_DEDUPE_TTL_MS, dedupe.max ?? DEFAULT_DEDUPE_MAX, now);
    this.dedupeKey = dedupe === false ? defaultDedupeKey : (dedupe.key ?? defaultDedupeKey);
  }

  get stats(): WebhookStats {
    return { ...this.counters };
  }

  /** Сверяет секрет за постоянное время. */
  verifySecret(headerValue: string | string[] | undefined): boolean {
    const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (typeof value !== 'string') return false;

    const received = Buffer.from(value);
    if (received.length !== this.secret.length) return false;

    return timingSafeEqual(received, this.secret);
  }

  /** Принимает тело запроса и ставит апдейт в очередь. */
  receive(rawBody: string, secretHeader: string | string[] | undefined): WebhookResult {
    if (!this.verifySecret(secretHeader)) {
      this.counters.rejected += 1;
      return { status: 401, body: 'Unauthorized' };
    }

    if (Buffer.byteLength(rawBody) > this.maxBodyBytes) {
      this.counters.rejected += 1;
      return { status: 413, body: 'Payload Too Large' };
    }

    let update: UpdateLike;

    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (typeof parsed !== 'object' || parsed === null || typeof (parsed as UpdateLike).update_type !== 'string') {
        throw new TypeError('Это не апдейт');
      }
      update = parsed as UpdateLike;
    } catch {
      this.counters.rejected += 1;
      return { status: 400, body: 'Bad Request' };
    }

    if (this.seen && !this.seen.add(this.dedupeKey(update))) {
      this.counters.duplicates += 1;
      return { status: 200, body: 'OK' };
    }

    this.counters.accepted += 1;
    void this.scheduler.run(this.orderingKey(update), () => this.handle(update));

    return { status: 200, body: 'OK' };
  }

  /** Дожидается обработки принятых апдейтов: вызывать при остановке процесса. */
  drain(): Promise<void> {
    return this.scheduler.drain();
  }

  /** Обработчик для `node:http`: следит за размером тела и не копит его сверх предела. */
  callback(): (request: IncomingMessage, response: ServerResponse) => void {
    return (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { 'content-type': 'text/plain' });
        response.end('Method Not Allowed');
        return;
      }

      if (!this.verifySecret(request.headers[BOT_API_SECRET_HEADER])) {
        this.counters.rejected += 1;
        response.writeHead(401, { 'content-type': 'text/plain' });
        response.end('Unauthorized');
        request.destroy();
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;

      request.on('error', () => {
        aborted = true;
      });

      request.on('data', (chunk: Buffer) => {
        if (aborted) return;

        size += chunk.length;
        if (size > this.maxBodyBytes) {
          aborted = true;
          this.counters.rejected += 1;
          response.writeHead(413, { 'content-type': 'text/plain' });
          response.end('Payload Too Large');
          request.destroy();
          return;
        }

        chunks.push(chunk);
      });

      request.on('end', () => {
        if (aborted) return;

        const result = this.receive(Buffer.concat(chunks).toString('utf8'), request.headers[BOT_API_SECRET_HEADER]);
        response.writeHead(result.status, { 'content-type': 'text/plain' });
        response.end(result.body);
      });
    };
  }

  private async handle(update: UpdateLike): Promise<void> {
    try {
      await this.options.handleUpdate(update);
      this.counters.processed += 1;
    } catch (error) {
      this.counters.failed += 1;
      this.options.onHandlerError?.(error, update);
    }
  }
}
