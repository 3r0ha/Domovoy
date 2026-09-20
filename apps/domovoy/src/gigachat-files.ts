import type { MeterVision, Transcriber } from '@domovoy/app';
import { DomainError } from '@domovoy/domain';

import { audioSeconds, sniffAudio, webmToOgg, type AudioContainer } from './audio.js';
import { sharedTokenSource, type GigaChatOptions } from './gigachat.js';
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
const MAX_VOICE_BYTES = 10 * 1024 * 1024;

/** Дольше двух минут модель разбирает запись дольше, чем жилец готов ждать. */
export const MAX_VOICE_SECONDS = 120;

const ABOUT_METER =
  'На снимке должно быть табло счётчика воды, электричества, газа или тепла. ' +
  'Прочитай показание: только цифры на самом табло, слева направо, вместе с ведущими нулями. ' +
  'Чёрные цифры это целая часть, красные цифры или цифры после запятой это дробная часть: запиши их после запятой. ' +
  'Серийный номер, год поверки, марку прибора и любые надписи не читай. ' +
  'Ответь одним числом без пояснений, например «01234,567». ' +
  'Если на снимке нет табло счётчика, ответь «нет». ' +
  'Если табло есть, но цифры не прочитать или рядов цифр несколько, ответь «неясно».';

const ABOUT_VOICE =
  'Это голосовое сообщение жильца управляющей организации дома. ' +
  'Расшифруй речь дословно, слово в слово: без пересказа, без пояснений и без вступления. ' +
  'Числа, которые человек называет как показание счётчика, запиши цифрами. ' +
  'Если речи нет, речь не на русском языке или слова не разобрать, ответь одним словом «нет».';

/** Ответ модели, по которому ясно, что разобрать не вышло. */
const NOTHING = /^\s*[«"']?нет[»"']?\s*[.!]?\s*$/iu;

/** Табло есть, а цифры не читаются: об этом модель говорит отдельным словом. */
const UNCLEAR = /^\s*[«"']?неясно[»"']?\s*[.!]?\s*$/iu;

/** Модель пересказала или отказалась вместо того, чтобы расшифровать. */
const RETOLD =
  /^(?:в\s+(?:этом|данном)?\s*(?:голосов|аудио|сообщени|запис)|жилец\s+(?:говорит|сообщает|жалуется|просит)|человек\s+(?:говорит|сообщает)|(?:к сожалению|извините|я не могу|не могу|не удалось|не получается|невозможно)|это\s+(?:голосов|аудио)|аудио(?:запись|файл)|запись\s+(?:не|пуст)|расшифров|текст\s+сообщения|содержание)/iu;

/** Подпись перед расшифровкой и кавычки вокруг неё: в ответ жильцу не идут. */
const WRAPPING = /^(?:расшифровка|текст|речь)\s*:\s*/iu;

const NAME_BY_CONTAINER: Record<AudioContainer, { name: string; type: string }> = {
  ogg: { name: 'voice.ogg', type: 'audio/ogg' },
  webm: { name: 'voice.ogg', type: 'audio/ogg' },
  mp4: { name: 'voice.m4a', type: 'audio/mp4' },
  wav: { name: 'voice.wav', type: 'audio/wav' },
  mp3: { name: 'voice.mp3', type: 'audio/mpeg' },
};

const NAME_BY_IMAGE: Record<string, string> = {
  'image/png': 'meter.png',
  'image/webp': 'meter.webp',
  'image/heic': 'meter.heic',
};

/**
 * Откуда берётся запись или снимок. Кроме адреса платформы это бывает сам файл
 * строкой: так приходит запись из мини-приложения, её нигде не хранят.
 */
const isDownloadable = (token: string): boolean =>
  token.startsWith('http://') || token.startsWith('https://') || token.startsWith('data:');

/** Речь на чужом языке: латиницы в ответе больше, чем кириллицы. */
const foreign = (text: string): boolean => {
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  const cyrillic = (text.match(/\p{Script=Cyrillic}/gu) ?? []).length;

  return latin > cyrillic;
};

/** Расшифровка из ответа модели. Пусто, если ответ не расшифровка. */
export const transcriptOf = (said: string): string | undefined => {
  const text = said
    .trim()
    .replace(WRAPPING, '')
    .replace(/^[«"']+/u, '')
    .replace(/[»"']+([.!?…]*)$/u, '$1')
    // Точка после числа это конец фразы, а не часть показания: «140,2.».
    .replace(/(\d)\.$/u, '$1')
    .trim();

  if (text.length === 0 || NOTHING.test(text) || RETOLD.test(text) || foreign(text)) return undefined;

  return text;
};

/** Показание из ответа модели. @throws {DomainError} если табло на снимке нет. */
export const readingOf = (said: string): number | undefined => {
  if (NOTHING.test(said)) throw new DomainError('meter_not_in_photo', 'На снимке не вижу табло счётчика');
  if (UNCLEAR.test(said)) return undefined;

  return parseReading({ text: said });
};

/** Запись, готовая к отправке модели: контейнер известен, длительность в пределах. */
const prepareVoice = (bytes: Uint8Array): { file: Blob; name: string } => {
  const container = sniffAudio(bytes);

  if (!container) throw new DomainError('file_type_not_allowed', 'Формат записи не поддерживается, запишите ещё раз');

  const seconds = audioSeconds(bytes);

  if (seconds !== undefined && seconds > MAX_VOICE_SECONDS) {
    throw new DomainError('voice_too_long', 'Запись длиннее двух минут. Скажите короче или напишите словами');
  }

  // Модель принимает opus только в ogg: из webm пакеты перекладываются как есть.
  const sound = container === 'webm' ? webmToOgg(bytes) : bytes;

  if (!sound) throw new DomainError('file_type_not_allowed', 'Формат записи не поддерживается, запишите ещё раз');

  const { name, type } = NAME_BY_CONTAINER[container];

  return { file: new Blob([new Uint8Array(sound)], { type }), name };
};

export const createGigaChatFiles = (
  options: GigaChatFilesOptions,
): { vision: MeterVision; transcriber: Transcriber } => {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.baseUrl ?? BASE_URL;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const tokenOf = sharedTokenSource(options);

  /** Скачивает вложение платформы, не доверяя объявленному размеру. */
  const download = async (url: string, limit: number, signal: AbortSignal): Promise<Blob | undefined> => {
    const response = await doFetch(url, { signal });

    if (!response.ok) return undefined;

    if (Number(response.headers.get('content-length') ?? '0') > limit) return undefined;

    const file = await response.blob();

    return file.size > limit ? undefined : file;
  };

  /**
   * Кладёт файл в хранилище модели и возвращает его идентификатор. Отказ по
   * самому файлу (формат, размер) это «не разобрали», отказ службы это сбой.
   */
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

    if (response.status >= 500) throw new Error(`GigaChat не принял файл: ${response.status}`);

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

  const answer = async (token: string, about: string, fileId: string, signal: AbortSignal): Promise<string> => {
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

    if (!response.ok) throw new Error(`GigaChat не разобрал файл: ${response.status}`);

    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const said = body.choices?.[0]?.message?.content;

    return typeof said === 'string' ? said : '';
  };

  /**
   * Общий путь: скачать, загрузить, спросить, убрать за собой. Всё в один
   * срок ожидания. Пусто, когда файл модели не подошёл. Сбой службы и
   * истёкший срок бросают ошибку: о них человеку говорят иначе, чем о том,
   * что разобрать не вышло.
   */
  const askAbout = async (
    source: Blob | string,
    prepare: (bytes: Blob) => Promise<{ file: Blob; name: string }>,
    about: string,
    limit: number,
  ): Promise<string | undefined> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let token: string | undefined;
    let fileId: string | undefined;

    try {
      const raw = typeof source === 'string' ? await download(source, limit, controller.signal) : source;

      if (!raw || raw.size > limit) return undefined;

      const { file, name } = await prepare(raw);

      token = await tokenOf();

      if (!token) throw new Error('GigaChat не выдал токен');

      fileId = await upload(token, file, name, controller.signal);

      if (!fileId) return undefined;

      return await answer(token, about, fileId, controller.signal);
    } catch (error) {
      options.onError?.(error);

      if (error instanceof DomainError) throw error;

      throw controller.signal.aborted ? new Error(`GigaChat не ответил за ${Math.round(timeoutMs / 1000)} с`) : error;
    } finally {
      clearTimeout(timer);

      if (token && fileId) await forget(token, fileId);
    }
  };

  const asImage = (image: Blob): Promise<{ file: Blob; name: string }> =>
    Promise.resolve({ file: image, name: NAME_BY_IMAGE[image.type] ?? 'meter.jpg' });

  const asVoice = async (sound: Blob): Promise<{ file: Blob; name: string }> =>
    prepareVoice(new Uint8Array(await sound.arrayBuffer()));

  const readMeter = async (source: Blob | string): Promise<number | undefined> => {
    const said = await askAbout(source, asImage, ABOUT_METER, MAX_IMAGE_BYTES);

    return said === undefined ? undefined : readingOf(said);
  };

  const vision: MeterVision = {
    read: (image) => readMeter(image),
    readUrl: (url) => (isDownloadable(url) ? readMeter(url) : Promise.resolve(undefined)),
  };

  const transcriber: Transcriber = {
    async transcribe(attachment) {
      if (attachment.kind !== 'voice' || !isDownloadable(attachment.token)) return undefined;

      const said = await askAbout(attachment.token, asVoice, ABOUT_VOICE, MAX_VOICE_BYTES);

      return said === undefined ? undefined : transcriptOf(said);
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
