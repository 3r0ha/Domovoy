import type { ValidatedInitData } from '@maxkit/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimit {
  /** Сколько запросов разрешено в окне. */
  limit: number;
  /** Длина окна в миллисекундах. */
  windowMs: number;
}

/**
 * Обычная работа в приложении. Один экран тянет несколько запросов сразу, а
 * человек листает разделы подряд, поэтому предел считается не по экранам, а по
 * запросам: шесть десятков уходили за полминуты обычного просмотра.
 */
export const DEFAULT_LIMIT: RateLimit = { limit: 300, windowMs: 60_000 };

/** Вход в приложение. */
export const LOGIN_LIMIT: RateLimit = { limit: 10, windowMs: 60_000 };

/** Выгрузки и импорт: один запрос стоит дороже обычного. */
export const HEAVY_LIMIT: RateLimit = { limit: 10, windowMs: 60_000 };

/**
 * Маршруты, которые читают или собирают файлы целиком либо рассылают их дому.
 * Запись вида «POST /api/files» считает дорогим только этот метод: выдача уже
 * загруженного снимка идёт в обычном темпе, их на экране несколько.
 */
export const HEAVY_PATHS = [
  '/api/import/',
  '/api/export/',
  '/api/report/',
  '/api/stickers/sheet',
  '/api/buildings/handover',
  'POST /api/files',
  '/api/voice',
];

/**
 * Что вообще считается. Статика лендинга и мини-приложения мимо: за общим
 * адресом дома одна страница тянет десятки файлов, и бюджет живых людей
 * уходил бы на них.
 */
export const GUARDED_PATHS = ['/api/', '/auth/', '/openapi.json'];

interface Window {
  count: number;
  /** Когда окно кончается: после этого счётчик начинается заново. */
  until: number;
}

/** Как часто проходить по окнам и выбрасывать протухшие. */
const CLEANUP_EVERY_MS = 60_000;

export interface RateLimiterOptions {
  /** Предел для обычных запросов. */
  requests?: RateLimit;
  /** Предел для входа: он дороже и доступен без токена. */
  login?: RateLimit;
  /** Предел для выгрузок и импорта. */
  heavy?: RateLimit;
  /** Начала путей, которые считаются дорогими. */
  heavyPaths?: string[];
  /** Начала путей, которые вообще считаются. */
  guardedPaths?: string[];
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
  const guardedPaths = options.guardedPaths ?? GUARDED_PATHS;
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

  let cleanedAt = 0;

  /** Уборка по времени: карта не растёт между запросами и не перебирается на каждом. */
  const cleanup = (): void => {
    const at = now();

    if (at - cleanedAt < CLEANUP_EVERY_MS) return;

    cleanedAt = at;

    for (const [key, window] of windows) {
      if (window.until <= at) windows.delete(key);
    }
  };

  /** Совпадение с записью дорогого маршрута: начало адреса и, если задан, метод. */
  const heavyMatch = (entry: string, method: string, url: string): boolean => {
    const space = entry.indexOf(' ');

    if (space < 0) return url.startsWith(entry);

    return method === entry.slice(0, space) && url.startsWith(entry.slice(space + 1));
  };

  /** Считается ли запрос вообще и по какому правилу. */
  const ruleFor = (method: string, url: string): { counted: boolean; isLogin: boolean; isHeavy: boolean } => {
    const counted = !exempt.has(url) && guardedPaths.some((path) => url.startsWith(path));
    const isLogin = counted && url.startsWith('/auth/session');

    return {
      counted,
      isLogin,
      isHeavy: counted && !isLogin && heavyPaths.some((entry) => heavyMatch(entry, method, url)),
    };
  };

  /**
   * Один запрос в счётчиках одного измерения: обычном и, для выгрузок, дорогом.
   * Дорогие маршруты считаются отдельно: обычный предел они не расходуют вхолостую.
   */
  const measure = (dimension: string, isLogin: boolean, isHeavy: boolean): number =>
    Math.max(
      allow(`${isLogin ? 'login' : 'api'}:${dimension}`, isLogin ? login : requests),
      isHeavy ? allow(`heavy:${dimension}`, heavy) : 0,
    );

  const tooMany = async (reply: FastifyReply, wait: number): Promise<void> => {
    await reply.code(429).header('retry-after', String(wait)).send({
      error: 'too_many_requests',
      message: `Слишком много запросов. Повторите через ${wait} с.`,
    });
  };

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const { counted, isLogin, isHeavy } = ruleFor(request.method, request.url);

    if (!counted) return;

    cleanup();

    // Счёт идёт от адреса: заголовок авторизации присылает кто угодно, и его
    // ротацией предел входа снимался бы.
    const wait = measure(`ip:${request.ip}`, isLogin, isHeavy);

    if (isLogin) request.rateLimitKey = `login:ip:${request.ip}`;

    if (wait > 0) await tooMany(reply, wait);
  });

  /**
   * Второе измерение: сессия. К этому времени токен уже проверен, поэтому
   * счётчик за ним настоящий, а не заявленный заголовком.
   */
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Сессия объявлена обязательной, чтобы обработчики её не проверяли,
    // но на открытых маршрутах её нет.
    const session = request.max as ValidatedInitData | undefined;

    if (!session) return;

    const { counted, isHeavy } = ruleFor(request.method, request.url);

    if (!counted) return;

    const wait = measure(`user:${session.userId}`, false, isHeavy);

    if (wait > 0) await tooMany(reply, wait);
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
