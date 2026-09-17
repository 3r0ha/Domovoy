import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimit {
  /** Сколько запросов разрешено в окне. */
  limit: number;
  /** Длина окна в миллисекундах. */
  windowMs: number;
}

/** Обычная работа в приложении. */
export const DEFAULT_LIMIT: RateLimit = { limit: 60, windowMs: 60_000 };

/** Вход в приложение. */
export const LOGIN_LIMIT: RateLimit = { limit: 10, windowMs: 60_000 };

/** Выгрузки и импорт: один запрос стоит дороже обычного. */
export const HEAVY_LIMIT: RateLimit = { limit: 10, windowMs: 60_000 };

/** Маршруты, которые читают или собирают файлы целиком. */
export const HEAVY_PATHS = ['/api/import/', '/api/export/', '/api/report/', '/api/stickers/sheet'];

interface Window {
  count: number;
  /** Когда окно кончается: после этого счётчик начинается заново. */
  until: number;
}

/** С какого числа окон начинаем выбрасывать протухшие. */
const CLEANUP_THRESHOLD = 10_000;

export interface RateLimiterOptions {
  /** Предел для обычных запросов. */
  requests?: RateLimit;
  /** Предел для входа: он дороже и доступен без токена. */
  login?: RateLimit;
  /** Предел для выгрузок и импорта. */
  heavy?: RateLimit;
  /** Начала путей, которые считаются дорогими. */
  heavyPaths?: string[];
  /** Пути, которые зовёт не человек: у них свой темп. */
  exempt?: string[];
  now?: () => number;
}

/** Ограничение частоты запросов. */
export const applyRateLimit = (fastify: FastifyInstance, options: RateLimiterOptions = {}): void => {
  const requests = options.requests ?? DEFAULT_LIMIT;
  const login = options.login ?? LOGIN_LIMIT;
  const heavy = options.heavy ?? HEAVY_LIMIT;
  const heavyPaths = options.heavyPaths ?? HEAVY_PATHS;
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();
  const exempt = new Set(['/health', ...(options.exempt ?? [])]);

  const allow = (key: string, rule: RateLimit): number => {
    const at = now();
    const found = windows.get(key);

    if (!found || found.until <= at) {
      windows.set(key, { count: 1, until: at + rule.windowMs });
      return 0;
    }

    found.count += 1;

    return found.count > rule.limit ? Math.ceil((found.until - at) / 1000) : 0;
  };

  /** Удачный вход из счётчика вычитается. */
  const forgive = (key: string): void => {
    const found = windows.get(key);

    if (found && found.count > 0) found.count -= 1;
  };

  const cleanup = (): void => {
    if (windows.size < CLEANUP_THRESHOLD) return;

    const at = now();

    for (const [key, window] of windows) {
      if (window.until <= at) windows.delete(key);
    }
  };

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (exempt.has(request.url)) return;

    cleanup();

    const isLogin = request.url.startsWith('/auth/session');
    const isHeavy = !isLogin && heavyPaths.some((path) => request.url.startsWith(path));
    const token = request.headers.authorization;
    const key = `${isLogin ? 'login' : 'api'}:${token ?? request.ip}`;
    const retryAfter = allow(key, isLogin ? login : requests);

    if (isLogin) request.rateLimitKey = key;

    // Дорогие маршруты считаются и отдельно: обычный предел они не расходуют вхолостую.
    const heavyAfter = isHeavy ? allow(`heavy:${token ?? request.ip}`, heavy) : 0;

    if (retryAfter === 0 && heavyAfter === 0) return;

    const wait = Math.max(retryAfter, heavyAfter);

    await reply.code(429).header('retry-after', String(wait)).send({
      error: 'too_many_requests',
      message: `Слишком много запросов. Повторите через ${wait} с.`,
    });
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.rateLimitKey;

    if (key && reply.statusCode < 400) forgive(key);
  });
};

declare module 'fastify' {
  interface FastifyRequest {
    /** Ключ счётчика входа: проставляется на входящем запросе. */
    rateLimitKey?: string;
  }
}
