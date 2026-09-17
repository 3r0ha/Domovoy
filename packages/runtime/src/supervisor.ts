import { MemoryMarkerStore, type MarkerStore } from './marker-store.js';
import { OrderedScheduler } from './scheduler.js';

export interface UpdateLike {
  update_type: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface FetchUpdatesResult {
  updates: UpdateLike[];
  marker?: number;
}

export type UpdateFetcher = (options: { marker?: number; signal: AbortSignal }) => Promise<FetchUpdatesResult>;

export interface SupervisorStats {
  /** Успешно обработанные апдейты. */
  processed: number;
  /** Апдейты, обработчик которых завершился ошибкой. */
  failed: number;
  /** Полученные пачки апдейтов. */
  batches: number;
  /** Неудачные попытки забрать апдейты. */
  fetchErrors: number;
  /** Неудачные попытки сохранить позицию: после перезапуска пачка придёт снова. */
  markerErrors: number;
  /** Последний сохранённый маркер. */
  marker: number | undefined;
}

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  random?: () => number;
}

export interface SupervisorOptions {
  fetchUpdates: UpdateFetcher;
  handleUpdate: (update: UpdateLike) => Promise<void>;
  /** Где хранится позиция в потоке. По умолчанию, в памяти. */
  markerStore?: MarkerStore;
  /** Сколько апдейтов обрабатывается одновременно. */
  concurrency?: number;
  /** Ключ упорядочивания. По умолчанию, чат апдейта. */
  orderingKey?: (update: UpdateLike) => string;
  onHandlerError?: (error: unknown, update: UpdateLike) => void;
  onFetchError?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Позицию не удалось сохранить. */
  onMarkerError?: (error: unknown, marker: number) => void;
  /** Пауза между итерациями цикла. */
  idleDelayMs?: number;
  backoff?: BackoffOptions;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });

const readNumber = (value: unknown): string | undefined => {
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return undefined;
};

/** Ключ упорядочивания по умолчанию, идентификатор чата, а при его отсутствии пользователя. */
export const defaultOrderingKey = (update: UpdateLike): string => {
  const candidates: unknown[] = [
    (update['message'] as { recipient?: { chat_id?: unknown } } | undefined)?.recipient?.chat_id,
    (update['message'] as { recipient?: { user_id?: unknown } } | undefined)?.recipient?.user_id,
    update['chat_id'],
    (update['callback'] as { user?: { user_id?: unknown } } | undefined)?.user?.user_id,
    (update['user'] as { user_id?: unknown } | undefined)?.user_id,
    update['user_id'],
  ];

  for (const candidate of candidates) {
    const key = readNumber(candidate);
    if (key !== undefined) return key;
  }

  return `${update.update_type}:unknown`;
};

/** Супервизор потока апдейтов. */
export class UpdateSupervisor {
  private readonly options: Required<Pick<SupervisorOptions, 'fetchUpdates' | 'handleUpdate'>> & SupervisorOptions;
  private readonly markerStore: MarkerStore;
  private readonly scheduler: OrderedScheduler;
  private readonly orderingKey: (update: UpdateLike) => string;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  private controller: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private marker: number | undefined;

  private readonly counters = { processed: 0, failed: 0, batches: 0, fetchErrors: 0, markerErrors: 0 };

  constructor(options: SupervisorOptions) {
    this.options = options;
    this.markerStore = options.markerStore ?? new MemoryMarkerStore();
    this.scheduler = new OrderedScheduler(options.concurrency ?? 16);
    this.orderingKey = options.orderingKey ?? defaultOrderingKey;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get stats(): SupervisorStats {
    return { ...this.counters, marker: this.marker };
  }

  get isRunning(): boolean {
    return this.loop !== null;
  }

  /** Запускает цикл. Промис завершается только после остановки. */
  async start(): Promise<void> {
    if (this.loop) return this.loop;

    this.controller = new AbortController();

    try {
      this.marker = await this.markerStore.load();
    } catch (error) {
      this.counters.markerErrors += 1;
      this.options.onMarkerError?.(error, 0);
    }

    this.loop = this.run(this.controller.signal);

    try {
      await this.loop;
    } finally {
      this.loop = null;
      this.controller = null;
    }
  }

  /** Останавливает приём новых апдейтов и дожидается завершения текущих. */
  async stop(): Promise<void> {
    this.controller?.abort();
    await this.loop;
  }

  private async run(signal: AbortSignal): Promise<void> {
    let fetchAttempt = 0;

    while (!signal.aborted) {
      let batch: FetchUpdatesResult;

      try {
        batch = await this.options.fetchUpdates({ marker: this.marker, signal });
        fetchAttempt = 0;
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (signal.aborted) break;

        fetchAttempt += 1;
        this.counters.fetchErrors += 1;

        const delayMs = this.backoffDelay(fetchAttempt);
        this.options.onFetchError?.(error, fetchAttempt, delayMs);
        await this.sleep(delayMs, signal);
        continue;
      }

      this.counters.batches += 1;

      for (const update of batch.updates) {
        void this.scheduler.run(this.orderingKey(update), () => this.handle(update));
      }

      await this.scheduler.drain();

      const nextMarker = this.resolveNextMarker(batch);

      if (nextMarker !== undefined && nextMarker !== this.marker) {
        this.marker = nextMarker;

        try {
          await this.markerStore.save(nextMarker);
        } catch (error) {
          this.counters.markerErrors += 1;
          this.options.onMarkerError?.(error, nextMarker);
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!signal.aborted) await this.sleep(this.options.idleDelayMs ?? 0, signal);
    }

    await this.scheduler.drain();
  }

  /** Позиция для следующего запроса. */
  private resolveNextMarker(batch: FetchUpdatesResult): number | undefined {
    if (batch.marker !== undefined) return batch.marker;
    if (batch.updates.length === 0) return undefined;

    return (this.marker ?? 1) + batch.updates.length;
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

  private backoffDelay(attempt: number): number {
    const base = this.options.backoff?.baseDelayMs ?? 1000;
    const max = this.options.backoff?.maxDelayMs ?? 60_000;
    const jitter = this.options.backoff?.jitter ?? true;
    const random = this.options.backoff?.random ?? Math.random;

    const capped = Math.min(base * 2 ** (attempt - 1), max);
    return jitter ? Math.round(capped * (0.5 + random() * 0.5)) : capped;
  }
}
