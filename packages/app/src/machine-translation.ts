import { DEFAULT_LANGUAGE, type Language } from '@domovoy/i18n';

import { languageOf } from './language.js';
import type { Resident, StoredTranslation } from './repository.js';
import type { AppDeps } from './use-cases.js';

/**
 * Порт машинного перевода. Отдельный от модельного: здесь переводится то, что
 * написал один человек, а читают многие, и обращение к модели на каждое
 * объявление стоило бы дороже самого ответа.
 */
export interface MachineTranslator {
  /**
   * Перевод пачки текстов. Длина ответа равна длине запроса, пустой элемент
   * означает, что этот текст перевести не удалось.
   */
  translate(texts: readonly string[], to: Language, from?: Language): Promise<(string | undefined)[]>;
}

const FNV_PRIME = 0x01000193;

const fnv = (bytes: Uint8Array, seed: number): number => {
  let hash = seed;

  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
  }

  return hash >>> 0;
};

/**
 * Отпечаток текста: по нему перевод ищется в хранилище. Два прохода с разными
 * началами и длина в конце: полный текст в ключе занимал бы больше самого перевода.
 */
export const textFingerprint = (text: string): string => {
  const bytes = new TextEncoder().encode(text.trim());
  const high = fnv(bytes, 0x811c9dc5);
  const low = fnv(bytes, 0x7f5c9e3b);

  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}${bytes.length.toString(16)}`;
};

/** Готовые переводы для одного ответа. */
export interface Translations {
  /** Перевод текста. Без перевода возвращается исходный текст. */
  of(text: string): string;
  /** Переведён ли машинно хоть один из этих текстов. */
  machine(...texts: (string | undefined)[]): boolean;
}

/** Переводов нет: продукт отдаёт то, что написано. */
export const NO_TRANSLATION: Translations = {
  of: (text) => text,
  machine: () => false,
};

/** Сколько текстов уходит в службу за один ответ. */
export const TRANSLATION_BATCH = 40;

/** Сколько ждём службу на всю пачку. */
export const TRANSLATION_TIMEOUT_MS = 3000;

/** Как долго помним, что служба не перевела: пробовать снова каждый раз незачем. */
export const TRANSLATION_MISS_MS = 10 * 60_000;

const HAS_LETTER = /\p{L}/u;

const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const limit = new Promise<undefined>((done) => {
    timer = setTimeout(() => done(undefined), ms);
  });

  try {
    return await Promise.race([work.catch(() => undefined), limit]);
  } finally {
    clearTimeout(timer);
  }
};

/** Что просим перевести: неповторяющиеся тексты с буквами, не больше пачки. */
const wantedTexts = (texts: readonly (string | undefined)[]): string[] =>
  [...new Set(texts.map((text) => text?.trim() ?? '').filter((text) => HAS_LETTER.test(text)))].slice(
    0,
    TRANSLATION_BATCH,
  );

/** Что уже переведено и что спрашивать не нужно. */
const fromStore = (
  known: readonly StoredTranslation[],
  sources: ReadonlyMap<string, string>,
  now: number,
): { ready: Map<string, string>; asked: Set<string> } => {
  const ready = new Map<string, string>();
  const asked = new Set<string>();

  for (const record of known) {
    const source = sources.get(record.fingerprint);

    if (source === undefined) continue;

    if (record.text) {
      ready.set(source, record.text);
      asked.add(source);
      continue;
    }

    if (now - record.at.getTime() < TRANSLATION_MISS_MS) asked.add(source);
  }

  return { ready, asked };
};

/**
 * Перевод текстов, которые уходят в ответ жильцу. Сначала хранилище, потом
 * служба одной пачкой с коротким ожиданием. Отказ и молчание службы оставляют
 * исходный текст: читать по-русски лучше, чем не получить ответа.
 */
export const translateForReading = async (
  deps: AppDeps,
  resident: Resident | undefined,
  texts: readonly (string | undefined)[],
): Promise<Translations> => {
  const language = languageOf(resident);

  if (!deps.machine || language === DEFAULT_LANGUAGE) return NO_TRANSLATION;

  const wanted = wantedTexts(texts);

  if (wanted.length === 0) return NO_TRANSLATION;

  const sources = new Map(wanted.map((text) => [textFingerprint(text), text]));
  const known = await deps.repository.listTranslations([...sources.keys()], language).catch(() => []);
  const { ready, asked } = fromStore(known, sources, deps.now().getTime());
  const missing = wanted.filter((text) => !asked.has(text));

  if (missing.length > 0) {
    const said = await withTimeout(
      deps.machine.translate(missing, language, DEFAULT_LANGUAGE),
      TRANSLATION_TIMEOUT_MS,
    );

    const at = deps.now();

    const records = missing.map((text, index) => {
      const translated = said?.[index]?.trim();
      const useful = translated && translated !== text ? translated : undefined;

      if (useful) ready.set(text, useful);

      return { fingerprint: textFingerprint(text), language, ...(useful ? { text: useful } : {}), at };
    });

    await deps.repository.saveTranslations(records).catch(() => undefined);
  }

  if (ready.size === 0) return NO_TRANSLATION;

  return {
    of: (text) => ready.get(text.trim()) ?? text,
    machine: (...items) => items.some((item) => item !== undefined && ready.has(item.trim())),
  };
};
