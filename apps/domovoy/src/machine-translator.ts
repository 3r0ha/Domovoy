import type { MachineTranslator } from '@domovoy/app';
import type { Language } from '@domovoy/i18n';

/** Сколько ждём службу на один текст. */
const TIMEOUT_MS = 2500;

/** Сколько запросов держим одновременно: бесплатные службы к напору не готовы. */
const CONCURRENCY = 4;

/** Перевод одного текста. Пусто означает, что служба не ответила или отказала. */
type TranslateOne = (text: string, to: Language, from: Language | undefined) => Promise<string | undefined>;

const mapLimited = async (
  texts: readonly string[],
  limit: number,
  run: (text: string) => Promise<string | undefined>,
): Promise<(string | undefined)[]> => {
  const done: (string | undefined)[] = new Array<string | undefined>(texts.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (let index = next++; index < texts.length; index = next++) {
      done[index] = await run(texts[index]!).catch(() => undefined);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, texts.length) }, worker));

  return done;
};

const batching = (one: TranslateOne, onError?: (error: unknown) => void): MachineTranslator => ({
  translate: (texts, to, from) =>
    mapLimited(texts, CONCURRENCY, (text) =>
      one(text, to, from).catch((error: unknown) => {
        onError?.(error);
        return undefined;
      }),
    ),
});

export interface LibreOptions {
  /** Адрес службы: к нему добавляется `/translate`. */
  url: string;
  /** Ключ. У своей установки его может не быть. */
  apiKey?: string;
  onError?: (error: unknown) => void;
  /** Подменяется в проверках. */
  fetch?: typeof globalThis.fetch;
}

/** LibreTranslate и совместимые службы. */
export const libreTranslator = (options: LibreOptions): MachineTranslator => {
  const endpoint = `${options.url.replace(/\/+$/u, '')}/translate`;
  const send = options.fetch ?? globalThis.fetch;

  return batching(async (text, to, from) => {
    const response = await send(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: from ?? 'auto',
        target: to,
        format: 'text',
        ...(options.apiKey ? { api_key: options.apiKey } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`LibreTranslate ответил ${String(response.status)}`);

    const body = (await response.json()) as { translatedText?: unknown };

    return typeof body.translatedText === 'string' ? body.translatedText : undefined;
  }, options.onError);
};

/** Адрес бесплатной службы MyMemory. */
export const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

/** Коды языков, которые MyMemory называет иначе. */
const MYMEMORY_CODES: Partial<Record<Language, string>> = { zh: 'zh-CN' };

const myMemoryCode = (language: Language): string => MYMEMORY_CODES[language] ?? language;

export interface MyMemoryOptions {
  url?: string;
  /** Почта: с ней дневной предел бесплатных переводов выше. */
  email?: string;
  onError?: (error: unknown) => void;
  /** Подменяется в проверках. */
  fetch?: typeof globalThis.fetch;
}

/** MyMemory: без ключа, один текст за запрос. */
export const myMemoryTranslator = (options: MyMemoryOptions = {}): MachineTranslator => {
  const send = options.fetch ?? globalThis.fetch;

  return batching(async (text, to, from) => {
    const url = new URL(options.url ?? MYMEMORY_URL);

    url.searchParams.set('q', text);
    url.searchParams.set('langpair', `${myMemoryCode(from ?? 'ru')}|${myMemoryCode(to)}`);
    if (options.email) url.searchParams.set('de', options.email);

    const response = await send(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

    if (!response.ok) throw new Error(`MyMemory ответил ${String(response.status)}`);

    const body = (await response.json()) as { responseStatus?: unknown; responseData?: { translatedText?: unknown } };

    if (Number(body.responseStatus) !== 200) return undefined;

    const said = body.responseData?.translatedText;

    // Исчерпанный дневной предел приходит как перевод, а не как ошибка.
    if (typeof said !== 'string' || said.startsWith('MYMEMORY WARNING')) return undefined;

    return said;
  }, options.onError);
};

/**
 * Машинный перевод из настроек окружения. Без `TRANSLATE_KIND` перевода нет,
 * и тексты показываются так, как они написаны.
 */
export const machineTranslatorFromEnv = (
  env: Record<string, string | undefined>,
  onError?: (error: unknown) => void,
): MachineTranslator | undefined => {
  const kind = env['TRANSLATE_KIND']?.trim();
  const url = env['TRANSLATE_URL']?.trim();
  const key = env['TRANSLATE_KEY']?.trim();
  const email = env['TRANSLATE_EMAIL']?.trim();

  if (kind === 'libre') {
    if (!url) return undefined;

    return libreTranslator({ url, ...(key ? { apiKey: key } : {}), ...(onError ? { onError } : {}) });
  }

  if (kind === 'mymemory') {
    return myMemoryTranslator({
      ...(url ? { url } : {}),
      ...(email ? { email } : {}),
      ...(onError ? { onError } : {}),
    });
  }

  return undefined;
};
