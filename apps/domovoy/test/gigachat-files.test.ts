import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '@domovoy/domain';

import { createGigaChatFiles, gigaChatFilesFromEnv, problemOf, readingOf, transcriptOf } from '../dist/gigachat-files.js';
import { mp4Of, oggOf, wavOf, webmOf } from './audio-fixtures.ts';

const IMAGE = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

/** Запись в виде вложения платформы: по ссылке. */
const VOICE = { kind: 'voice' as const, token: 'https://max.test/voice.ogg' };

interface Call {
  url: string;
  method: string;
  /** Имя файла, под которым запись ушла модели. */
  name?: string;
}

/**
 * Подстановка вместо сети: выдача токена, приём файла, ответ модели и удаление
 * файла отвечают по своим адресам, а вызовы запоминаются по порядку.
 */
const stub = (
  said: string,
  options: { upload?: number; chat?: number; sound?: Uint8Array; hang?: boolean; token?: number } = {},
) => {
  const calls: Call[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const file = init?.body instanceof FormData ? init.body.get('file') : null;

    // Запись из приложения лежит в самом адресе: её читает настоящий fetch.
    if (url.startsWith('data:')) return globalThis.fetch(url);

    calls.push({ url, method, ...(file instanceof File ? { name: file.name } : {}) });

    const answer = (body: unknown, status = 200): Promise<Response> =>
      Promise.resolve(
        new Response(status >= 400 ? null : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );

    if (url.includes('/oauth')) {
      return answer({ access_token: 'token-1', expires_at: Date.now() + 600_000 }, options.token);
    }
    if (url.endsWith('/delete')) return answer({ deleted: true });
    if (url.endsWith('/files')) return answer({ id: 'file-1' }, options.upload);
    if (url.endsWith('/chat/completions')) {
      if (options.hang) {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('прервано'), { name: 'AbortError' })));
        });
      }

      return answer({ choices: [{ message: { content: said } }] }, options.chat);
    }

    // Скачивание вложения платформы: запись приходит потоком.
    return Promise.resolve(new Response(new Blob([new Uint8Array(options.sound ?? oggOf(3))])));
  };

  return { calls, fetch: fetchStub };
};

const files = (said: string, options: Parameters<typeof stub>[1] & { timeoutMs?: number } = {}) => {
  const { calls, fetch } = stub(said, options);

  return {
    calls,
    ...createGigaChatFiles({ authKey: 'key', fetch, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) }),
  };
};

/** Данные записи из мини-приложения: файл уходит в самом токене. */
const dataUrl = (bytes: Uint8Array, type: string): string => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;

describe('догадка по снимку поломки', () => {
  it('короткая фраза о поломке проходит, кавычки и точка снимаются', () => {
    assert.equal(problemOf('«разбито стекло в окне на лестнице».'), 'Разбито стекло в окне на лестнице');
    assert.equal(problemOf('Течёт труба под раковиной'), 'Течёт труба под раковиной');
  });

  it('неуверенный ответ, пересказ и рассуждение догадкой не становятся', () => {
    assert.equal(problemOf('нет'), undefined);
    assert.equal(problemOf('Нет.'), undefined);
    assert.equal(problemOf('На снимке видно окно в подъезде'), undefined);
    assert.equal(problemOf('К сожалению, не могу определить'), undefined);
    assert.equal(problemOf('The window is broken'), undefined, 'ответ не по-русски');
    assert.equal(problemOf('Разбито стекло.\nРекомендую вызвать мастера'), undefined, 'две строки это уже совет');
    assert.equal(problemOf('В'.repeat(120)), undefined, 'слишком длинно для названия');
  });
});

describe('снимки и голосовые через GigaChat', () => {
  it('число с табло читается ответом модели', async () => {
    const { vision, calls } = files('01234,5');

    assert.equal(await vision.read(IMAGE), 1234.5);

    // Файл кладётся в хранилище, спрашивается и убирается оттуда же.
    assert.deepEqual(
      calls.map((call) => call.url.split('/api/v1')[1] ?? 'oauth'),
      ['oauth', '/files', '/chat/completions', '/files/file-1/delete'],
    );
  });

  it('снимок по ссылке сначала скачивается', async () => {
    const { vision, calls } = files('126');

    assert.equal(await vision.readUrl?.('https://max.test/photo.jpg'), 126);
    assert.equal(calls[0]?.url, 'https://max.test/photo.jpg');
  });

  it('ссылка не по HTTP разбором не считается', async () => {
    const { vision, calls } = files('126');

    assert.equal(await vision.readUrl?.('file:///etc/passwd'), undefined);
    assert.equal(calls.length, 0, 'за чужим файлом сходили');
  });

  it('снимок без табло отвергается своим кодом, а нечитаемое табло пустым ответом', async () => {
    const { vision } = files('нет');

    await assert.rejects(vision.read(IMAGE), (error: unknown) => error instanceof DomainError && error.code === 'meter_not_in_photo');

    assert.equal(await files('неясно').vision.read(IMAGE), undefined);
    assert.equal(await files('01234,5 и 21458763').vision.read(IMAGE), undefined, 'два числа это не показание');
    assert.equal(await files('348,00512').vision.read(IMAGE), undefined, 'два ряда цифр через запятую');
  });

  it('голосовое расшифровывается словами жильца', async () => {
    const { transcriber, calls } = files('У меня течёт труба под раковиной.');

    assert.equal(await transcriber.transcribe(VOICE), 'У меня течёт труба под раковиной.');
    assert.equal(calls.find((call) => call.url.endsWith('/files'))?.name, 'voice.ogg');
  });

  it('вложение не голосовое расшифровке не подлежит', async () => {
    const { transcriber, calls } = files('всё равно что');

    assert.equal(await transcriber.transcribe({ kind: 'photo', token: 'https://max.test/photo.jpg' }), undefined);
    assert.equal(calls.length, 0);
  });

  it('запись из приложения уходит под своим именем: webm перекладывается в ogg', async () => {
    const packet = [0xf8, 1, 2, 3];
    const cases: [Uint8Array, string, string][] = [
      [webmOf([packet, packet]), 'audio/webm', 'voice.ogg'],
      [mp4Of(2), 'audio/mp4', 'voice.m4a'],
      [wavOf(1), 'audio/wav', 'voice.wav'],
      [oggOf(2), 'audio/ogg', 'voice.ogg'],
    ];

    for (const [sound, type, name] of cases) {
      const { transcriber, calls } = files('Течёт кран');

      assert.equal(await transcriber.transcribe({ kind: 'voice', token: dataUrl(sound, type) }), 'Течёт кран');
      assert.equal(calls.find((call) => call.url.endsWith('/files'))?.name, name, type);
    }
  });

  it('файл не звук: отказ по формату до обращения к модели', async () => {
    const { transcriber, calls } = files('Течёт кран');

    await assert.rejects(
      transcriber.transcribe({ kind: 'voice', token: dataUrl(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'audio/ogg') }),
      (error: unknown) => error instanceof DomainError && error.code === 'file_type_not_allowed',
    );
    assert.equal(calls.some((call) => call.url.endsWith('/files')), false);
  });

  it('запись длиннее двух минут не расшифровывается, о чём говорится словами', async () => {
    const { transcriber, calls } = files('Длинный рассказ', { sound: oggOf(121) });

    await assert.rejects(
      transcriber.transcribe(VOICE),
      (error: unknown) => error instanceof DomainError && error.code === 'voice_too_long',
    );
    assert.equal(calls.some((call) => call.url.endsWith('/files')), false, 'запись всё равно ушла модели');

    assert.equal(await files('Успел', { sound: oggOf(119) }).transcriber.transcribe(VOICE), 'Успел');
  });

  it('«нет» в ответе означает, что разобрать не вышло', async () => {
    assert.equal(await files('нет').transcriber.transcribe(VOICE), undefined);
    assert.equal(await files('«Нет».').transcriber.transcribe(VOICE), undefined);
  });

  it('пересказ, отказ и чужой язык расшифровкой не считаются', () => {
    assert.equal(transcriptOf('В этом голосовом сообщении жилец жалуется на трубу.'), undefined);
    assert.equal(transcriptOf('Жилец говорит, что нет воды.'), undefined);
    assert.equal(transcriptOf('К сожалению, я не могу расшифровать аудио.'), undefined);
    assert.equal(transcriptOf('The elevator is broken again.'), undefined);
    assert.equal(transcriptOf(''), undefined);
    assert.equal(transcriptOf('Расшифровка: «Нет горячей воды».'), 'Нет горячей воды.');
    assert.equal(transcriptOf('Холодная вода 12350.'), 'Холодная вода 12350', 'точка после числа мешает разбору показания');
    assert.equal(transcriptOf('140,2.'), '140,2');
  });

  it('у языка с латиницей латинская речь и есть своя', () => {
    assert.equal(transcriptOf('Liftda qoldim, eshik ochilmayapti.', 'uz'), 'Liftda qoldim, eshik ochilmayapti.');
    assert.equal(transcriptOf('The elevator is broken again.', 'en'), 'The elevator is broken again.');
    assert.equal(transcriptOf('Лифт кайра бузулду.', 'ky'), 'Лифт кайра бузулду.');
    assert.equal(transcriptOf('The elevator is broken again.', 'ky'), undefined, 'у кириллицы латиница чужая');
  });

  it('показание из ответа: одно число, иначе пусто', () => {
    assert.equal(readingOf('01234,5'), 1234.5);
    assert.equal(readingOf('12345 м³'), 12345);
    assert.equal(readingOf('неясно'), undefined);
    assert.equal(readingOf('01234,5 (поверка 2024)'), undefined);
    assert.throws(() => readingOf('нет'), (error: unknown) => error instanceof DomainError);
  });

  it('модель не приняла файл: разобрать не вышло, а сбой службы это ошибка', async () => {
    assert.equal(await files('126', { upload: 413 }).vision.read(IMAGE), undefined);
    assert.equal(await files('126', { upload: 400 }).transcriber.transcribe(VOICE), undefined);

    await assert.rejects(files('126', { chat: 500 }).vision.read(IMAGE), /500/);
    await assert.rejects(files('126', { upload: 503 }).transcriber.transcribe(VOICE), /503/);
    await assert.rejects(files('126', { token: 429 }).transcriber.transcribe(VOICE), /токен/);
  });

  it('ответ дольше срока обрывается с понятной ошибкой, а файл убирается', async () => {
    const { transcriber, calls } = files('поздно', { hang: true, timeoutMs: 50 });

    await assert.rejects(transcriber.transcribe(VOICE), /не ответил за/);
    assert.ok(calls.some((call) => call.url.endsWith('/delete')), 'файл остался в хранилище');
  });

  it('без ключа разбора файлов нет', () => {
    assert.equal(gigaChatFilesFromEnv({}), undefined);
    assert.notEqual(gigaChatFilesFromEnv({ GIGACHAT_AUTH_KEY: 'key' }), undefined);
  });
});
