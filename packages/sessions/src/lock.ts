import { randomUUID } from 'node:crypto';

import type { KeyValueClient } from './key-value.js';

export interface LockOptions {
  /** Срок жизни блокировки. Если процесс умрёт, ключ освободится сам. */
  ttlMs?: number;
  /** Сколько ждать освобождения перед отказом. */
  waitMs?: number;
  /** Пауза между попытками захвата. */
  retryDelayMs?: number;
  /** Продлевать блокировку, пока выполняется задача под `withLock`. */
  autoExtend?: boolean;
  /** Префикс ключей. */
  prefix?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Источник идентификаторов владельца, подменяется в тестах. */
  createToken?: () => string;
}

export class LockTimeoutError extends Error {
  constructor(readonly key: string, readonly waitedMs: number) {
    super(`Не удалось получить блокировку «${key}» за ${waitedMs} мс`);
    this.name = 'LockTimeoutError';
  }
}

export interface LockHandle {
  /** Токен владельца: снять блокировку может только он. */
  readonly token: string;
  /** Продлевает срок жизни. Нужен долгим обработчикам. */
  extend(ttlMs?: number): Promise<boolean>;
  release(): Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Распределённая блокировка поверх key-value хранилища. */
export class DistributedLock {
  private readonly ttlMs: number;
  private readonly waitMs: number;
  private readonly retryDelayMs: number;
  private readonly prefix: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly createToken: () => string;
  private readonly autoExtend: boolean;

  constructor(
    private readonly client: KeyValueClient,
    options: LockOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 10_000;
    this.waitMs = options.waitMs ?? 5000;
    this.retryDelayMs = options.retryDelayMs ?? 50;
    this.prefix = options.prefix ?? 'maxkit:lock:';
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.createToken = options.createToken ?? randomUUID;
    this.autoExtend = options.autoExtend ?? true;
  }

  /** Пытается захватить блокировку один раз. */
  async tryAcquire(key: string, ttlMs = this.ttlMs): Promise<LockHandle | null> {
    const token = this.createToken();
    const fullKey = this.prefix + key;

    const acquired = await this.client.setIfAbsent(fullKey, token, ttlMs);
    if (!acquired) return null;

    return this.createHandle(fullKey, token, ttlMs);
  }

  /** Ждёт освобождения не дольше `waitMs`. */
  async acquire(key: string, ttlMs = this.ttlMs): Promise<LockHandle> {
    const deadline = this.now() + this.waitMs;

    for (;;) {
      const handle = await this.tryAcquire(key, ttlMs);
      if (handle) return handle;

      if (this.now() >= deadline) throw new LockTimeoutError(key, this.waitMs);
      await this.sleep(this.retryDelayMs);
    }
  }

  /** Выполняет задачу под блокировкой и освобождает её в любом случае. */
  async withLock<T>(key: string, task: () => Promise<T>, ttlMs = this.ttlMs): Promise<T> {
    const handle = await this.acquire(key, ttlMs);
    const stopWatchdog = this.startWatchdog(handle, ttlMs);

    try {
      return await task();
    } finally {
      stopWatchdog();
      await handle.release();
    }
  }

  /** Блокировка продлевается, пока задача работает: её срок рассчитан на смерть процесса. */
  private startWatchdog(handle: LockHandle, ttlMs: number): () => void {
    if (!this.autoExtend) return () => undefined;

    const interval = Math.max(Math.floor(ttlMs / 2), 1);
    const timer = setInterval(() => {
      void handle.extend(ttlMs).catch(() => undefined);
    }, interval);

    timer.unref();

    return () => clearInterval(timer);
  }

  private createHandle(fullKey: string, token: string, ttlMs: number): LockHandle {
    let released = false;

    return {
      token,
      extend: async (nextTtlMs = ttlMs) => {
        if (released) return false;

        return this.client.extendIfValue(fullKey, token, nextTtlMs);
      },
      release: async () => {
        if (released) return;
        released = true;
        await this.client.deleteIfValue(fullKey, token);
      },
    };
  }
}
