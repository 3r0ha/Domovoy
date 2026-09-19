import type { MeterVision, Transcriber } from '@domovoy/app';

import { createTokenSource, type GigaChatOptions } from './gigachat.js';
import { parseReading } from './meter-vision.js';

/**
 * Снимок табло и голосовое сообщение разбирает та же модель, что и текст:
 * файл кладётся в хранилище GigaChat и прикладывается к вопросу. Отдельные
 * службы распознавания при этом не нужны, и ключ остаётся один.
 */
export interface GigaChatFilesOptions extends GigaChatOptions {
  /** Адрес API без хвоста: от него считаются `/files` и `/chat/completions`. */
  baseUrl?: string;
  timeoutMs?: number;
}

const BASE_URL = 'https://gigachat.devices.sberbank.ru/api/v1';

/** Сколько ждать разбора файла: жилец ждёт ответа в переписке. */
const TIMEOUT_MS = 30_000;

/** Предел размера: у изображения он свой, у записи свой. */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VOICE_BYTES = 35 * 1024 * 1024;

const ABOUT_METER =
  'На снимке табло счётчика коммунального ресурса. Назови только число с табло, ' +
  'цифрами, с запятой, если она есть. Ничего не объясняй. Если числа не видно, ответь «нет».';

const ABOUT_VOICE =
  'Это голосовое сообщение жильца управляющей организации. Расшифруй речь дословно, ' +
  'без пересказа и без пояснений. Если речи нет, ответь «нет».';

/** Ответ модели, по которому ясно, что разобрать не вышло. */
const NOTHING = /^\s*нет\s*[.!]?\s*$/iu;

interface Asked {
  /** Загруженный файл: его убирают из хранилища после ответа. */
  fileId?: string;
  text?: string;
}

/**
 * Откуда берётся запись или снимок. Кроме адреса платформы это бывает сам файл
 * строкой: так приходит запись из мини-приложения, её нигде не хранят.
 */
const isDownloadable = (token: string): boolean =>
  token.startsWith('http://') || token.startsWith('https://') || token.startsWith('data:');

export const createGigaChatFiles = (
  options: GigaChatFilesOptions,
): { vision: MeterVision; transcriber: Transcriber } => {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.baseUrl ?? BASE_URL;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const tokenOf = createTokenSource(options);

  /** Скачивает вложение платформы, не доверяя объявленному размеру. */
  const download = async (url: string, limit: number, signal: AbortSignal): Promise<Blob | undefined> => {
    const response = await doFetch(url, { signal });

    if (!response.ok) return undefined;

    if (Number(response.headers.get('content-length') ?? '0') > limit) return undefined;

    const file = await response.blob();

    return file.size > limit ? undefined : file;
  };

  /** Кладёт файл в хранилище модели и возвращает его идентификатор. */
  const upload = async (
    token: string,
    file: Blob,
    name: string,
    signal: AbortSignal,
  ): Promise<string | undefined> => {
    const form = new FormData();

    form.append('file', file, name);
    form.append('purpose', 'general');

    const response = await doFetch(`${base}/files`, {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      body: form,
    });

    if (!response.ok) {
      options.onError?.(new Error(`GigaChat не принял файл: ${response.status}`));
      return undefined;
    }

    const body = (await response.json()) as { id?: unknown };

    return typeof body.id === 'string' ? body.id : undefined;
  };

  /**
   * Файл жильца в хранилище модели не остаётся: он нужен ровно на один вопрос.
   * Отказ в удалении разбор не роняет, но виден в журнале.
   */
  const forget = async (token: string, fileId: string): Promise<void> => {
    await doFetch(`${base}/files/${fileId}/delete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    }).catch((error: unknown) => {
      options.onError?.(error);

      return undefined;
    });
  };

  const answer = async (token: string, about: string, fileId: string, signal: AbortSignal): Promise<string | undefined> => {
    const response = await doFetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? 'GigaChat-2-Max',
        messages: [{ role: 'user', content: about, attachments: [fileId] }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      options.onError?.(new Error(`GigaChat не разобрал файл: ${response.status}`));
      return undefined;
    }

    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const said = body.choices?.[0]?.message?.content;

    return typeof said === 'string' && said.trim().length > 0 && !NOTHING.test(said) ? said.trim() : undefined;
  };

  /** Общий путь: скачать, загрузить, спросить, убрать за собой. */
  const askAbout = async (source: Blob | string, name: string, about: string, limit: number): Promise<Asked> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let token: string | undefined;
    let fileId: string | undefined;

    try {
      token = await tokenOf();

      if (!token) return {};

      const file = typeof source === 'string' ? await download(source, limit, controller.signal) : source;

      if (!file || file.size > limit) return {};

      fileId = await upload(token, file, name, controller.signal);

      if (!fileId) return {};

      return { fileId, ...(await answer(token, about, fileId, controller.signal).then((text) => ({ text }))) };
    } catch (error) {
      options.onError?.(error);

      return { ...(fileId ? { fileId } : {}) };
    } finally {
      clearTimeout(timer);

      if (token && fileId) await forget(token, fileId);
    }
  };

  const vision: MeterVision = {
    async read(image) {
      const { text } = await askAbout(image, 'meter.jpg', ABOUT_METER, MAX_IMAGE_BYTES);

      return text === undefined ? undefined : parseReading({ text });
    },
    async readUrl(url) {
      if (!isDownloadable(url)) return undefined;

      const { text } = await askAbout(url, 'meter.jpg', ABOUT_METER, MAX_IMAGE_BYTES);

      return text === undefined ? undefined : parseReading({ text });
    },
  };

  const transcriber: Transcriber = {
    async transcribe(attachment) {
      if (attachment.kind !== 'voice' || !isDownloadable(attachment.token)) return undefined;

      const { text } = await askAbout(attachment.token, 'voice.ogg', ABOUT_VOICE, MAX_VOICE_BYTES);

      return text;
    },
  };

  return { vision, transcriber };
};

/**
 * Разбор снимков и голосовых тем же ключом, что и разбор текста. Пусто, если
 * ключа нет: тогда показания вводятся цифрами, а голосовое идёт вложением.
 */
export const gigaChatFilesFromEnv = (
  env: Record<string, string | undefined>,
  onError?: (error: unknown) => void,
): { vision: MeterVision; transcriber: Transcriber } | undefined => {
  const authKey = env['GIGACHAT_AUTH_KEY']?.trim();

  if (!authKey) return undefined;

  const endpoint = env['GIGACHAT_URL']?.trim();

  return createGigaChatFiles({
    authKey,
    ...(env['GIGACHAT_SCOPE']?.trim() ? { scope: env['GIGACHAT_SCOPE'].trim() } : {}),
    ...(env['GIGACHAT_MODEL']?.trim() ? { model: env['GIGACHAT_MODEL'].trim() } : {}),
    // Адрес чата задан целиком: файловые ручки лежат рядом с ним.
    ...(endpoint ? { baseUrl: endpoint.replace(/\/chat\/completions$/u, '') } : {}),
    ...(onError ? { onError } : {}),
  });
};
