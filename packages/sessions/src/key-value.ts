/** Узкий интерфейс хранилища, которого достаточно для сессий и блокировок. */
export interface KeyValueClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  /** Записывает значение, только если ключа ещё нет. Возвращает признак успеха. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Удаляет ключ, только если его значение совпадает с ожидаемым. */
  deleteIfValue(key: string, value: string): Promise<boolean>;
  /** Продлевает срок жизни ключа, только если его значение совпадает с ожидаемым. */
  extendIfValue(key: string, value: string, ttlMs: number): Promise<boolean>;
}

interface Entry {
  value: string;
  expiresAt: number;
}

/** Хранилище в памяти процесса: тесты и однопроцессный запуск. */
export class MemoryKeyValueClient implements KeyValueClient {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    this.sweep();
    return this.entries.size;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.read(key);
    return entry?.value ?? null;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: ttlMs === undefined ? Infinity : this.now() + ttlMs });
  }

  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.read(key)) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async deleteIfValue(key: string, value: string): Promise<boolean> {
    const entry = this.read(key);
    if (entry?.value !== value) return false;

    this.entries.delete(key);
    return true;
  }

  async extendIfValue(key: string, value: string, ttlMs: number): Promise<boolean> {
    const entry = this.read(key);
    if (entry?.value !== value) return false;

    entry.expiresAt = this.now() + ttlMs;
    return true;
  }

  private read(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry;
  }

  /** Убирает просроченные записи, чтобы память не росла из-за разовых пользователей. */
  sweep(): number {
    let removed = 0;
    const now = this.now();

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }

    return removed;
  }
}

/** Клиент `ioredis`: флаги передаются позиционно. */
export interface IoredisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<number>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

/** Клиент `node-redis` v4: флаги передаются объектом. */
export interface NodeRedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { PX?: number; NX?: boolean }): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

/** Снятие атомарно: между чтением и удалением блокировка может достаться другому. */
const DELETE_IF_VALUE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/** Продление атомарно: срок продлевает только текущий владелец. */
const EXTEND_IF_VALUE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export const fromIoredis = (redis: IoredisLike): KeyValueClient => ({
  async get(key) {
    return redis.get(key);
  },
  async set(key, value, ttlMs) {
    if (ttlMs === undefined) await redis.set(key, value);
    else await redis.set(key, value, 'PX', ttlMs);
  },
  async setIfAbsent(key, value, ttlMs) {
    const result = await redis.set(key, value, 'PX', ttlMs, 'NX');
    return result === 'OK';
  },
  async delete(key) {
    await redis.del(key);
  },
  async deleteIfValue(key, value) {
    const result = await redis.eval(DELETE_IF_VALUE, 1, key, value);
    return result === 1;
  },
  async extendIfValue(key, value, ttlMs) {
    const result = await redis.eval(EXTEND_IF_VALUE, 1, key, value, String(ttlMs));
    return result === 1;
  },
});

export const fromNodeRedis = (client: NodeRedisLike): KeyValueClient => ({
  async get(key) {
    return client.get(key);
  },
  async set(key, value, ttlMs) {
    await client.set(key, value, ttlMs === undefined ? undefined : { PX: ttlMs });
  },
  async setIfAbsent(key, value, ttlMs) {
    const result = await client.set(key, value, { PX: ttlMs, NX: true });
    return result === 'OK';
  },
  async delete(key) {
    await client.del(key);
  },
  async deleteIfValue(key, value) {
    const result = await client.eval(DELETE_IF_VALUE, { keys: [key], arguments: [value] });
    return result === 1;
  },
  async extendIfValue(key, value, ttlMs) {
    const result = await client.eval(EXTEND_IF_VALUE, { keys: [key], arguments: [value, String(ttlMs)] });
    return result === 1;
  },
});
