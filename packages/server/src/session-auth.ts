import { randomBytes } from 'node:crypto';

import type { InitData } from '@maxkit/bridge';

import { validateInitData, type ValidateInitDataOptions, type ValidatedInitData } from './init-data.js';

export type SessionErrorCode = 'session_missing' | 'session_invalid' | 'session_expired';

export class SessionError extends Error {
  readonly code: SessionErrorCode;
  readonly statusCode = 401;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

export interface SessionRecord {
  userId: number;
  data: InitData;
  /** Строка запуска, из которой выдана сессия. */
  initData: string;
  issuedAt: number;
  expiresAt: number;
}

export interface SessionTokenStore {
  get(token: string): Promise<SessionRecord | undefined> | SessionRecord | undefined;
  set(token: string, record: SessionRecord): Promise<void> | void;
  delete(token: string): Promise<void> | void;
}

/** Хранилище сессий в памяти процесса: разработка и один экземпляр сервера. */
export class MemorySessionTokenStore implements SessionTokenStore {
  private readonly records = new Map<string, SessionRecord>();
  private writesSinceSweep = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sweepEvery = 100,
  ) {}

  get size(): number {
    return this.records.size;
  }

  get(token: string): SessionRecord | undefined {
    return this.records.get(token);
  }

  set(token: string, record: SessionRecord): void {
    this.records.set(token, record);

    this.writesSinceSweep += 1;
    if (this.writesSinceSweep >= this.sweepEvery) this.sweep();
  }

  delete(token: string): void {
    this.records.delete(token);
  }

  /** Убирает записи, срок которых истёк. */
  sweep(): number {
    const now = this.now();
    let removed = 0;

    for (const [token, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(token);
        removed += 1;
      }
    }

    this.writesSinceSweep = 0;
    return removed;
  }
}

/** Минимальный интерфейс внешнего хранилища для сессий. */
export interface SessionKeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Насколько запись переживает собственный срок, чтобы истёкшая сессия отличалась от неизвестной. */
const EXPIRY_GRACE_MS = 60_000;

/** Сессии вне процесса. */
export class KeyValueSessionTokenStore implements SessionTokenStore {
  constructor(
    private readonly kv: SessionKeyValue,
    private readonly prefix = 'session:',
    private readonly now: () => number = Date.now,
  ) {}

  async get(token: string): Promise<SessionRecord | undefined> {
    const stored = await this.kv.get(this.prefix + token);

    if (!stored) return undefined;

    try {
      return JSON.parse(stored) as SessionRecord;
    } catch {
      return undefined;
    }
  }

  async set(token: string, record: SessionRecord): Promise<void> {
    const ttlMs = Math.max(1, record.expiresAt - this.now() + EXPIRY_GRACE_MS);

    await this.kv.set(this.prefix + token, JSON.stringify(record), ttlMs);
  }

  async delete(token: string): Promise<void> {
    await this.kv.delete(this.prefix + token);
  }
}

export interface SessionAuthOptions extends ValidateInitDataOptions {
  store?: SessionTokenStore;
  /** Время жизни сессии. */
  sessionTtlMs?: number;
  createToken?: () => string;
}

export interface IssuedSession {
  token: string;
  expiresAt: number;
  session: SessionRecord;
}

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Обмен параметров запуска на сессионный токен. */
export class SessionAuth {
  private readonly store: SessionTokenStore;
  private readonly sessionTtlMs: number;
  private readonly createToken: () => string;
  private readonly now: () => number;

  constructor(private readonly options: SessionAuthOptions) {
    this.store = options.store ?? new MemorySessionTokenStore(options.now ?? Date.now);
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.createToken = options.createToken ?? (() => randomBytes(32).toString('base64url'));
    this.now = options.now ?? Date.now;
  }

  /** Проверяет строку запуска и выдаёт токен @throws {InitDataError} если подпись не сходится или параметры устарели. */
  async issue(initData: string | null | undefined): Promise<IssuedSession> {
    const validated: ValidatedInitData = validateInitData(initData, this.options);

    const issuedAt = this.now();
    const record: SessionRecord = {
      userId: validated.userId,
      data: validated.data,
      initData: validated.raw,
      issuedAt,
      expiresAt: issuedAt + this.sessionTtlMs,
    };

    const token = this.createToken();
    await this.store.set(token, record);

    return { token, expiresAt: record.expiresAt, session: record };
  }

  /** @throws {SessionError} */
  async verify(token: string | null | undefined): Promise<SessionRecord> {
    if (!token) throw new SessionError('session_missing', 'Сессионный токен не передан');

    const record = await this.store.get(token);
    if (!record) throw new SessionError('session_invalid', 'Сессия не найдена');

    if (record.expiresAt <= this.now()) {
      await this.store.delete(token);
      throw new SessionError('session_expired', 'Сессия истекла, перезапустите мини-приложение');
    }

    return record;
  }

  /** Продлевает сессию, выдавая новый токен: старый сразу перестаёт работать. */
  async refresh(token: string | null | undefined): Promise<IssuedSession> {
    const record = await this.verify(token);
    await this.store.delete(token as string);

    const issuedAt = this.now();
    const next: SessionRecord = { ...record, issuedAt, expiresAt: issuedAt + this.sessionTtlMs };
    const nextToken = this.createToken();
    await this.store.set(nextToken, next);

    return { token: nextToken, expiresAt: next.expiresAt, session: next };
  }

  async revoke(token: string): Promise<void> {
    await this.store.delete(token);
  }
}

export const createSessionAuth = (options: SessionAuthOptions): SessionAuth => new SessionAuth(options);
