/** Причина отмены в виде `Error`. */
export const toAbortError = (reason: unknown): Error => {
  if (reason instanceof Error) return reason;

  const error = new Error('Операция отменена', { cause: reason });
  error.name = 'AbortError';
  return error;
};

/** Ожидание с поддержкой отмены. */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(toAbortError(signal.reason));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(toAbortError(signal?.reason));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
