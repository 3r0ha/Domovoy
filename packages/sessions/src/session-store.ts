import type { KeyValueClient } from './key-value.js';

/** Совпадает с `AsyncSessionStore` официального SDK. */
export interface AsyncSessionStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

export interface SessionStoreOptions<T> {
  prefix?: string;
  /** Срок хранения сессии. */
  ttlMs?: number;
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
  /** Вызывается, если сохранённое значение не удалось разобрать. */
  onCorruptedValue?: (key: string, raw: string, error: unknown) => void;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Хранилище сессий поверх key-value: Redis, Valkey или любой совместимый клиент. */
export class KeyValueSessionStore<T> implements AsyncSessionStore<T> {
  private readonly prefix: string;
  private readonly ttlMs: number;
  private readonly serialize: (value: T) => string;
  private readonly deserialize: (raw: string) => T;
  private readonly onCorruptedValue: SessionStoreOptions<T>['onCorruptedValue'];

  constructor(
    private readonly client: KeyValueClient,
    options: SessionStoreOptions<T> = {},
  ) {
    this.prefix = options.prefix ?? 'maxkit:session:';
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.serialize = options.serialize ?? ((value) => JSON.stringify(value));
    this.deserialize = options.deserialize ?? ((raw) => JSON.parse(raw) as T);
    this.onCorruptedValue = options.onCorruptedValue;
  }

  async get(key: string): Promise<T | undefined> {
    const raw = await this.client.get(this.prefix + key);
    if (raw === null) return undefined;

    try {
      return this.deserialize(raw);
    } catch (error) {
      this.onCorruptedValue?.(key, raw, error);
      await this.delete(key);
      return undefined;
    }
  }

  async set(key: string, value: T): Promise<void> {
    await this.client.set(this.prefix + key, this.serialize(value), this.ttlMs);
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(this.prefix + key);
  }
}
