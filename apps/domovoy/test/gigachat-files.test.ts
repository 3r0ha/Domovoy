import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGigaChatFiles, gigaChatFilesFromEnv } from '../dist/gigachat-files.js';

const IMAGE = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

interface Call {
  url: string;
  method: string;
}

/**
 * Подстановка вместо сети: выдача токена, приём файла, ответ модели и удаление
 * файла отвечают по своим адресам, а вызовы запоминаются по порядку.
 */
const stub = (said: string, options: { upload?: number; chat?: number } = {}) => {
  const calls: Call[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';

    calls.push({ url, method });

    const answer = (body: unknown, status = 200): Promise<Response> =>
      Promise.resolve(
        new Response(status >= 400 ? null : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );

    if (url.includes('/oauth')) return answer({ access_token: 'token-1', expires_at: Date.now() + 600_000 });
    if (url.endsWith('/delete')) return answer({ deleted: true });
    if (url.endsWith('/files')) return answer({ id: 'file-1' }, options.upload);
    if (url.endsWith('/chat/completions')) {
      return answer({ choices: [{ message: { content: said } }] }, options.chat);
    }

    // Скачивание вложения платформы: запись приходит потоком.
    return Promise.resolve(new Response(new Blob([new Uint8Array([1, 2, 3])])));
  };

  return { calls, fetch: fetchStub };
};

const files = (said: string, options: { upload?: number; chat?: number } = {}) => {
  const { calls, fetch } = stub(said, options);

  return { calls, ...createGigaChatFiles({ authKey: 'key', fetch }) };
};

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
    assert.equal(calls[1]?.url, 'https://max.test/photo.jpg');
  });

  it('ссылка не по HTTP разбором не считается', async () => {
    const { vision, calls } = files('126');

    assert.equal(await vision.readUrl?.('file:///etc/passwd'), undefined);
    assert.equal(calls.length, 0, 'за чужим файлом сходили');
  });

  it('голосовое расшифровывается словами жильца', async () => {
    const { transcriber } = files('У меня течёт труба под раковиной.');

    assert.equal(
      await transcriber.transcribe({ kind: 'voice', token: 'https://max.test/voice.ogg' }),
      'У меня течёт труба под раковиной.',
    );
  });

  it('вложение не голосовое расшифровке не подлежит', async () => {
    const { transcriber, calls } = files('всё равно что');

    assert.equal(await transcriber.transcribe({ kind: 'photo', token: 'https://max.test/photo.jpg' }), undefined);
    assert.equal(calls.length, 0);
  });

  it('«нет» в ответе означает, что разобрать не вышло', async () => {
    const { vision } = files('нет');
    const { transcriber } = files('нет');

    assert.equal(await vision.read(IMAGE), undefined);
    assert.equal(await transcriber.transcribe({ kind: 'voice', token: 'https://max.test/voice.ogg' }), undefined);
  });

  it('отказ службы разбор не роняет', async () => {
    const { vision } = files('126', { chat: 500 });
    const failed = files('126', { upload: 413 });

    assert.equal(await vision.read(IMAGE), undefined);
    assert.equal(await failed.vision.read(IMAGE), undefined);
  });

  it('без ключа разбора файлов нет', () => {
    assert.equal(gigaChatFilesFromEnv({}), undefined);
    assert.notEqual(gigaChatFilesFromEnv({ GIGACHAT_AUTH_KEY: 'key' }), undefined);
  });
});
