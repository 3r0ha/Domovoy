export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RetryDecisionInput {
  /** HTTP-метод запроса. */
  method: HttpMethod;
  /** Метод Bot API, например `messages`, для точечных исключений. */
  apiMethod: string;
  /** Номер попытки, начиная с 1. */
  attempt: number;
  /** Код ответа, если ответ вообще пришёл. */
  status?: number;
  /** Сетевая ошибка, если ответа не было. */
  error?: unknown;
}

export interface RetryOptions {
  /** Максимальное число попыток, включая первую. По умолчанию 3. */
  attempts?: number;
  /** Базовая задержка перед второй попыткой. */
  baseDelayMs?: number;
  /** Потолок задержки. */
  maxDelayMs?: number;
  /** Разброс задержки, чтобы клиенты не били по серверу синхронно. */
  jitter?: boolean;
  /** Своя политика поверх стандартной. */
  shouldRetry?: (input: RetryDecisionInput) => boolean;
  /** Источник случайности для джиттера, подменяется в тестах. */
  random?: () => number;
}

/** Методы, повторный вызов которых не создаёт нового эффекта. */
const IDEMPOTENT_METHODS = new Set<HttpMethod>(['GET', 'PUT', 'DELETE']);

/** Шлюз не донёс запрос до приложения: повтор безопасен даже для POST. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/** Политика повторов по умолчанию. */
export const defaultShouldRetry = ({ method, status, error }: RetryDecisionInput): boolean => {
  if (status === 429) return true;
  if (status !== undefined && GATEWAY_STATUSES.has(status)) return true;

  const isServerError = status !== undefined && status >= 500;
  const isNetworkFailure = status === undefined && error !== undefined;

  if (isServerError || isNetworkFailure) return IDEMPOTENT_METHODS.has(method);

  return false;
};

export interface ResolvedRetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  shouldRetry: (input: RetryDecisionInput) => boolean;
  random: () => number;
}

export const resolveRetryOptions = (options: RetryOptions = {}): ResolvedRetryOptions => ({
  attempts: Math.max(1, Math.trunc(options.attempts ?? 3)),
  baseDelayMs: options.baseDelayMs ?? 300,
  maxDelayMs: options.maxDelayMs ?? 10_000,
  jitter: options.jitter ?? true,
  shouldRetry: options.shouldRetry ?? defaultShouldRetry,
  random: options.random ?? Math.random,
});

/** Экспоненциальная задержка с равномерным джиттером. */
export const computeRetryDelay = (
  attempt: number,
  options: ResolvedRetryOptions,
  retryAfterMs?: number,
): number => {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, options.maxDelayMs);
  }

  const exponential = options.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, options.maxDelayMs);

  return options.jitter ? Math.round(capped * (0.5 + options.random() * 0.5)) : capped;
};

/** Разбирает заголовок `Retry-After`: и число секунд, и HTTP-дата. */
export const parseRetryAfter = (header: string | null, now: number = Date.now()): number | undefined => {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;

  return Math.max(0, date - now);
};
