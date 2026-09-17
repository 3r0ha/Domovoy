/** Клиент MAX бросает объекты вида `{ error: { code } }`. */
export class MaxBridgeError extends Error {
  readonly code: string;
  readonly raw: unknown;

  constructor(code: string, message?: string, raw?: unknown) {
    super(message ?? code);
    this.name = 'MaxBridgeError';
    this.code = code;
    this.raw = raw;
  }

  /** Запрос не получил ответа за отведённое время. */
  get isTimeout(): boolean {
    return this.code.endsWith('.request_timeout');
  }

  /** Возможность не поддерживается платформой или устройством. */
  get isUnsupported(): boolean {
    return this.code.endsWith('.not_supported');
  }

  /** Пользователь не дал разрешение. */
  get isPermissionDenied(): boolean {
    return this.code.endsWith('.permission_denied');
  }

  /** Запрос отменён через AbortSignal. */
  get isAborted(): boolean {
    return this.code.endsWith('.aborted');
  }

  /** Приложение открыто вне клиента MAX, обращаться некуда. */
  get isOutsideMax(): boolean {
    return this.code.endsWith('.not_available');
  }
}

type RawBridgeError = { error?: { code?: unknown; message?: unknown } };

export const toBridgeError = (raw: unknown, fallbackCode = 'client.unknown_error'): MaxBridgeError => {
  if (raw instanceof MaxBridgeError) return raw;

  if (typeof raw === 'object' && raw !== null && 'error' in raw) {
    const { error } = raw as RawBridgeError;
    const code = typeof error?.code === 'string' ? error.code : fallbackCode;
    const message = typeof error?.message === 'string' ? error.message : undefined;
    return new MaxBridgeError(code, message, raw);
  }

  if (raw instanceof Error) return new MaxBridgeError(fallbackCode, raw.message, raw);

  return new MaxBridgeError(fallbackCode, undefined, raw);
};

/** `WebAppOpenCodeReader` -> `open_code_reader`, как это делает клиент MAX при таймауте. */
export const methodSlug = (eventType: string): string => {
  const tail = eventType.split('WebApp')[1];
  if (!tail) return 'unknown_method';
  const words = tail.match(/([A-Z][a-z0-9]*)/g);
  return words ? words.map((word) => word.toLowerCase()).join('_') : 'unknown_method';
};
