import type { Transcriber } from '@domovoy/app';

/** Распознавание речи через внешнюю службу. */
export interface HttpTranscriberOptions {
  /** Адрес службы, принимающей запись и возвращающей `{ "text": "…" }`. */
  endpoint: string;
  /** Ключ доступа, если служба его требует. */
  apiKey?: string;
  /** Модель распознавания, если служба даёт выбор. */
  model?: string;
  /** Язык записи. */
  language?: string;
  /** Сколько ждать ответа. Дольше минуты ждать нечего: жилец уже ушёл. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  onError?: (error: unknown) => void;
}

/** Предел размера голосового сообщения. */
const MAX_BYTES = 20 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 30_000;

/** Адрес платформы или сам файл строкой: запись из приложения нигде не хранится. */
const isDownloadable = (token: string): boolean =>
  token.startsWith('http://') || token.startsWith('https://') || token.startsWith('data:');

/** Скачивает запись, не доверяя размеру. */
const download = async (
  doFetch: typeof globalThis.fetch,
  url: string,
  signal: AbortSignal,
): Promise<Blob | undefined> => {
  const response = await doFetch(url, { signal });

  if (!response.ok) return undefined;

  const declared = Number(response.headers.get('content-length') ?? '0');

  if (declared > MAX_BYTES) return undefined;

  const blob = await response.blob();

  return blob.size > MAX_BYTES ? undefined : blob;
};

export const createHttpTranscriber = (options: HttpTranscriberOptions): Transcriber => {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async transcribe(attachment) {
      if (attachment.kind !== 'voice' || !isDownloadable(attachment.token)) return undefined;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const recording = await download(doFetch, attachment.token, controller.signal);

        if (!recording) return undefined;

        const form = new FormData();

        form.append('file', recording, 'voice.ogg');
        if (options.model) form.append('model', options.model);
        if (options.language) form.append('language', options.language);

        const response = await doFetch(options.endpoint, {
          method: 'POST',
          signal: controller.signal,
          ...(options.apiKey ? { headers: { authorization: `Bearer ${options.apiKey}` } } : {}),
          body: form,
        });

        if (!response.ok) {
          options.onError?.(new Error(`Служба распознавания ответила ${response.status}`));
          return undefined;
        }

        const body = (await response.json()) as { text?: unknown };

        return typeof body.text === 'string' && body.text.trim().length > 0 ? body.text.trim() : undefined;
      } catch (error) {
        options.onError?.(error);
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  };
};

/** Распознавание из настроек окружения. */
export const transcriberFromEnv = (
  env: Record<string, string | undefined>,
  onError?: (error: unknown) => void,
): Transcriber | undefined => {
  const endpoint = env['SPEECH_URL'];

  if (!endpoint) return undefined;

  return createHttpTranscriber({
    endpoint,
    ...(env['SPEECH_KEY'] ? { apiKey: env['SPEECH_KEY'] } : {}),
    ...(env['SPEECH_MODEL'] ? { model: env['SPEECH_MODEL'] } : {}),
    language: env['SPEECH_LANGUAGE'] ?? 'ru',
    ...(onError ? { onError } : {}),
  });
};
