import { MaxBridgeError, methodSlug, toBridgeError } from './errors.js';
import { DEFAULT_TIMEOUT_MS, EVENT_TIMEOUTS, type RequestEvent, type RequestEventMap } from './events.js';
import type { BridgeTransport } from './transport.js';

export interface RequestOptions {
  timeout?: number;
  /** Отмена запроса: экран закрыт, пользователь ушёл, компонент размонтирован. */
  signal?: AbortSignal;
}

export type RequestFn = <E extends RequestEvent>(
  type: E,
  params?: RequestEventMap[E]['params'],
  options?: RequestOptions,
) => Promise<RequestEventMap[E]['result']>;

interface PendingRequest {
  resolve: (value: never) => void;
  reject: (reason: MaxBridgeError) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  type: string;
  /** Снимает таймер и слушатель отмены, вызывается ровно один раз. */
  cleanup: () => void;
}

const newRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  let id = Date.now().toString(36);
  while (id.length < 32) id += Math.random().toString(36).slice(2);
  return id.slice(0, 32);
};

const isResponse = (payload: Record<string, unknown>): payload is Record<string, unknown> & { requestId: string } =>
  typeof payload['requestId'] === 'string' && payload['requestId'].length > 0;

/** Сопоставляет ответы клиента с отправленными запросами по `requestId` и следит за таймаутами. */
export class RequestController {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly transport: BridgeTransport) {}

  request<E extends RequestEvent>(
    type: E,
    params: RequestEventMap[E]['params'] | Record<string, unknown> = {},
    options: RequestOptions = {},
  ): Promise<RequestEventMap[E]['result']> {
    const timeout = options.timeout ?? EVENT_TIMEOUTS[type] ?? DEFAULT_TIMEOUT_MS;
    const slug = methodSlug(type);

    if (options.signal?.aborted) {
      return Promise.reject(new MaxBridgeError(`client.${slug}.aborted`, `Запрос ${type} отменён до отправки`));
    }

    return new Promise<RequestEventMap[E]['result']>((resolve, reject) => {
      const requestId = newRequestId();

      const timeoutId = setTimeout(() => {
        this.settle(requestId);
        reject(new MaxBridgeError(`client.${slug}.request_timeout`, `Таймаут запроса ${type}`));
      }, timeout);

      const onAbort = (): void => {
        this.settle(requestId);
        reject(new MaxBridgeError(`client.${slug}.aborted`, `Запрос ${type} отменён`));
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(requestId, {
        resolve: resolve,
        reject,
        timeoutId,
        type,
        cleanup: () => {
          clearTimeout(timeoutId);
          options.signal?.removeEventListener('abort', onAbort);
        },
      });

      try {
        this.transport.send(type, { ...(params as Record<string, unknown>), requestId });
      } catch (error) {
        this.settle(requestId);
        reject(new MaxBridgeError(`client.${slug}.send_failed`, `Не удалось отправить запрос ${type}`, error));
      }
    });
  }

  /** Снимает запрос с учёта и освобождает его ресурсы. */
  private settle(requestId: string): PendingRequest | undefined {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;

    pending.cleanup();
    this.pending.delete(requestId);
    return pending;
  }

  /** @returns `true`, если сообщение было ответом на запрос и обработано здесь. */
  handleMessage(type: string, payload: Record<string, unknown>): boolean {
    if (!isResponse(payload)) return false;

    const { requestId, ...rest } = payload;
    const pending = this.settle(requestId);
    if (!pending) return true;

    if ('error' in rest) {
      pending.reject(toBridgeError(rest, `client.${methodSlug(type)}.unknown_error`));
    } else {
      pending.resolve(rest as never);
    }

    return true;
  }

  /** Сколько запросов ещё ждут ответа, полезно в тестах и в отладочной панели. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Отклоняет все незавершённые запросы, например, при размонтировании приложения. */
  destroy(reason = 'client.bridge.destroyed'): void {
    for (const requestId of [...this.pending.keys()]) {
      const pending = this.settle(requestId);
      pending?.reject(new MaxBridgeError(reason, `Запрос ${pending.type} отменён`));
    }
  }
}
