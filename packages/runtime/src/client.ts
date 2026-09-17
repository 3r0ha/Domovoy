import { RateLimiter, type RateLimiterOptions } from './rate-limiter.js';
import { sleep } from './sleep.js';
import {
  computeRetryDelay,
  parseRetryAfter,
  resolveRetryOptions,
  type HttpMethod,
  type RetryOptions,
} from './retry.js';

/** Форма запроса, которую передаёт официальный SDK. */
export interface RequestOptions {
  method?: HttpMethod;
  body?: object | null;
  query?: Record<string, string | number | boolean | null | undefined>;
  path?: Record<string, string | number | boolean>;
  signal?: AbortSignal;
}

export interface CallOptions {
  method: string;
  options: RequestOptions;
}

export interface ApiResponse {
  status: number;
  data: unknown;
}

/** Структурно совместим с `Client` из SDK. */
export interface ResilientClient {
  call(options: CallOptions): Promise<ApiResponse>;
}

export interface RequestInfo {
  /** Метод Bot API, например `messages` или `chats/{chatId}`. */
  apiMethod: string;
  httpMethod: HttpMethod;
  url: string;
  attempt: number;
}

export interface RuntimeHooks {
  onRequest?(info: RequestInfo): void;
  onResponse?(info: RequestInfo & { status: number; durationMs: number }): void;
  onRetry?(info: RequestInfo & { delayMs: number; status?: number; error?: unknown }): void;
  onFailure?(info: RequestInfo & { status?: number; error?: unknown }): void;
  /** Вызывается, когда запрос простоял в очереди лимитера. */
  onRateLimitWait?(info: { apiMethod: string; waitedMs: number }): void;
}

export interface ResilientClientOptions {
  baseUrl?: string;
  /** Своя реализация fetch: прокси, mTLS, тестовый двойник. */
  fetch?: typeof globalThis.fetch;
  /** Таймаут одной попытки. */
  timeoutMs?: number;
  retry?: RetryOptions;
  rateLimit?: RateLimiterOptions | false;
  hooks?: RuntimeHooks;
  /** Значение заголовка User-Agent. */
  userAgent?: string;
}

const DEFAULT_BASE_URL = 'https://platform-api2.max.ru';
const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = 'maxkit-runtime/0.1.0';

const buildPath = (template: string, path: RequestOptions['path']): string => {
  if (!path) return template;

  let result = template;
  for (const [key, value] of Object.entries(path)) {
    result = result.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
  }
  return result;
};

const buildUrl = (baseUrl: string, method: string, options: RequestOptions): URL => {
  const url = new URL(buildPath(method, options.path), baseUrl);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  return url;
};

const parseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) return {};

  const text = await response.text();
  if (text.length === 0) return {};

  try {
    return JSON.parse(text);
  } catch {
    const contentType = response.headers.get('content-type') ?? 'unknown';
    return {
      code: 'unexpected.response',
      message: `Failed to parse JSON. Content-Type was "${contentType}"`,
    };
  }
};

const combineSignals = (signals: (AbortSignal | undefined)[]): AbortSignal | undefined => {
  const defined = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  return AbortSignal.any(defined);
};

/** HTTP-клиент Bot API с ретраями, таймаутами и соблюдением лимита платформы. */
export const createResilientClient = (token: string, options: ResilientClientOptions = {}): ResilientClient => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retry = resolveRetryOptions(options.retry);
  const limiter = options.rateLimit === false ? null : new RateLimiter(options.rateLimit ?? {});
  const hooks = options.hooks ?? {};
  const userAgent = options.userAgent ?? USER_AGENT;

  const call = async ({ method: apiMethod, options: request }: CallOptions): Promise<ApiResponse> => {
    if (!token) {
      return { status: 401, data: { code: 'verify.token', message: 'Empty access_token' } };
    }

    const httpMethod = request.method ?? 'GET';
    const url = buildUrl(baseUrl, apiMethod, request);
    const href = url.href;

    let lastError: unknown;
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
      const info: RequestInfo = { apiMethod, httpMethod, url: href, attempt };

      if (limiter) {
        const waitedMs = await limiter.acquire(request.signal);
        if (waitedMs > 0) hooks.onRateLimitWait?.({ apiMethod, waitedMs });
      }

      const headers: Record<string, string> = { Authorization: token, 'user-agent': userAgent };
      const init: RequestInit = { method: httpMethod, headers };

      if (request.body) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(request.body);
      }

      const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
      const signal = combineSignals([request.signal, timeoutSignal]);
      if (signal) init.signal = signal;

      const startedAt = Date.now();
      hooks.onRequest?.(info);

      let response: Response;

      try {
        response = await doFetch(href, init);
      } catch (error) {
        if (request.signal?.aborted) throw error;

        lastError = error;
        lastStatus = undefined;

        const canRetry =
          attempt < retry.attempts && retry.shouldRetry({ method: httpMethod, apiMethod, attempt, error });

        if (!canRetry) {
          hooks.onFailure?.({ ...info, error });
          throw error;
        }

        const delayMs = computeRetryDelay(attempt, retry);
        hooks.onRetry?.({ ...info, delayMs, error });
        await sleep(delayMs, request.signal);
        continue;
      }

      hooks.onResponse?.({ ...info, status: response.status, durationMs: Date.now() - startedAt });
      lastStatus = response.status;

      if (response.status === 401) {
        return { status: 401, data: { code: 'verify.token', message: 'Invalid access_token' } };
      }

      const canRetry =
        attempt < retry.attempts &&
        retry.shouldRetry({ method: httpMethod, apiMethod, attempt, status: response.status });

      if (!canRetry) {
        return { status: response.status, data: await parseBody(response) };
      }

      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      const delayMs = computeRetryDelay(attempt, retry, retryAfterMs);

      if (response.status === 429) limiter?.pause(retryAfterMs ?? delayMs);
      hooks.onRetry?.({ ...info, delayMs, status: response.status });
      await sleep(delayMs, request.signal);
    }

    hooks.onFailure?.({
      apiMethod,
      httpMethod,
      url: href,
      attempt: retry.attempts,
      ...(lastStatus !== undefined ? { status: lastStatus } : {}),
      error: lastError,
    });

    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw lastError ?? new Error(`Запрос ${apiMethod} исчерпал ${retry.attempts} попыток`);
  };

  return { call };
};
