import { type DistributedLock, LockTimeoutError } from './lock.js';
import type { AsyncSessionStore } from './session-store.js';

/** Минимум, который нужен для вычисления ключа сессии. */
export interface SessionContextLike {
  chatId?: number;
  user?: { user_id?: number };
}

export type Middleware<Ctx> = (context: Ctx, next: () => Promise<void>) => Promise<void>;

export interface DistributedSessionOptions<S, Ctx extends SessionContextLike> {
  store: AsyncSessionStore<S>;
  lock: DistributedLock;
  /** Поле контекста, в которое кладётся состояние. */
  property?: string;
  /** Ключ сессии. По умолчанию `<user_id>:<chat_id>`, как в официальном SDK. */
  getSessionKey?: (context: Ctx) => string | null | undefined | Promise<string | null | undefined>;
  /** Начальное состояние для нового ключа. */
  defaultSession?: (context: Ctx) => S;
  /** Срок жизни блокировки: должен превышать самый долгий обработчик. */
  lockTtlMs?: number;
  /** Если блокировка не досталась: `throw`, ошибка наверх, `skip`, работа без сессии. */
  onLockTimeout?: 'throw' | 'skip';
  onLockTimeoutError?: (error: LockTimeoutError, context: Ctx) => void;
}

const defaultGetSessionKey = (context: SessionContextLike): string | undefined => {
  const userId = context.user?.user_id;
  const { chatId } = context;

  if (userId == null || chatId == null) return undefined;
  return `${userId}:${chatId}`;
};

const UNSAFE_PROPERTIES = new Set(['__proto__', 'constructor', 'prototype']);

/** Сессия с блокировкой, разделяемой между экземплярами бота. */
export const distributedSession = <S extends object, Ctx extends SessionContextLike>(
  options: DistributedSessionOptions<S, Ctx>,
): Middleware<Ctx> => {
  const property = options.property ?? 'session';
  if (UNSAFE_PROPERTIES.has(property)) {
    throw new TypeError(`Небезопасное имя поля сессии: «${property}»`);
  }

  const getSessionKey = options.getSessionKey ?? defaultGetSessionKey;
  const createSession = options.defaultSession ?? ((): S => ({}) as S);
  const onLockTimeout = options.onLockTimeout ?? 'throw';

  return async (context, next) => {
    const key = await getSessionKey(context);

    if (key == null) {
      Reflect.set(context, property, undefined);
      await next();
      return;
    }

    const run = async (): Promise<void> => {
      const stored = await options.store.get(key);
      Reflect.set(context, property, stored ?? createSession(context));

      try {
        await next();
      } finally {
        const current = Reflect.get(context, property) as S | undefined;
        if (current == null) await options.store.delete(key);
        else await options.store.set(key, current);
      }
    };

    try {
      await options.lock.withLock(key, run, options.lockTtlMs);
    } catch (error) {
      if (error instanceof LockTimeoutError && onLockTimeout === 'skip') {
        options.onLockTimeoutError?.(error, context);
        Reflect.set(context, property, undefined);
        await next();
        return;
      }

      throw error;
    }
  };
};
