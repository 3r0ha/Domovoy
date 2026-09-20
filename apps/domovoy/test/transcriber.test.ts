import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Attachment } from '@domovoy/domain';

import { createHttpTranscriber, transcriberFromEnv } from '../dist/transcriber.js';

const VOICE: Attachment = { kind: 'voice', token: 'https://files.max.test/voice-1.ogg' };

interface Call {
  url: string;
  method: string;
  body?: unknown;
  headers?: HeadersInit;
}

/** Служба распознавания, которую можно расспросить. */
const stub = (options: {
  recording?: { bytes?: Uint8Array; status?: number; contentLength?: string };
  answer?: { text?: unknown; status?: number };
  onSecond?: () => never;
}) => {
  const calls: Call[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    calls.push({
      url,
      method: init?.method ?? 'GET',
      ...(init?.body === undefined ? {} : { body: init.body }),
      ...(init?.headers === undefined ? {} : { headers: init.headers }),
    });

    if (calls.length === 1) {
      const recording = options.recording ?? {};
      const bytes = recording.bytes ?? new Uint8Array([1, 2, 3]);

      return Promise.resolve(
        new Response(recording.status === undefined || recording.status < 400 ? new Uint8Array(bytes) : null, {
          status: recording.status ?? 200,
          ...(recording.contentLength ? { headers: { 'content-length': recording.contentLength } } : {}),
        }),
      );
    }

    options.onSecond?.();

    const answer = options.answer ?? {};

    return Promise.resolve(
      new Response(JSON.stringify({ text: answer.text }), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { fetchStub, calls };
};

describe('распознавание голосовых заявок', () => {
  it('скачивает запись и отдаёт расшифровку', async () => {
    const { fetchStub, calls } = stub({ answer: { text: '  Нет горячей воды в третьем подъезде  ' } });

    const transcriber = createHttpTranscriber({
      endpoint: 'https://speech.test/v1/audio/transcriptions',
      apiKey: 'secret',
      model: 'whisper-1',
      language: 'ru',
      fetch: fetchStub,
    });

    assert.equal(await transcriber.transcribe(VOICE), 'Нет горячей воды в третьем подъезде');

    assert.equal(calls[0]?.url, VOICE.token, 'сначала скачиваем запись');
    assert.equal(calls[1]?.url, 'https://speech.test/v1/audio/transcriptions');
    assert.equal(calls[1]?.method, 'POST');

    const form = calls[1]?.body;

    assert.ok(form instanceof FormData, 'запись уходит формой, а не строкой');
    assert.equal(form.get('model'), 'whisper-1');
    assert.equal(form.get('language'), 'ru');
    assert.ok(form.get('file'), 'без файла распознавать нечего');

    assert.deepEqual(calls[1]?.headers, { authorization: 'Bearer secret' });
  });

  it('язык человека уходит службе вместо языка по умолчанию', async () => {
    const { fetchStub, calls } = stub({ answer: { text: 'Issiq suv yoʻq' } });

    const transcriber = createHttpTranscriber({
      endpoint: 'https://speech.test/v1/audio/transcriptions',
      language: 'ru',
      fetch: fetchStub,
    });

    assert.equal(await transcriber.transcribe(VOICE, 'uz'), 'Issiq suv yoʻq');

    const form = calls[1]?.body;

    assert.ok(form instanceof FormData);
    assert.equal(form.get('language'), 'uz', 'служба распознаёт на языке говорящего');
  });

  it('вложение без ссылки не скачивается', async () => {
    const { fetchStub, calls } = stub({});
    const transcriber = createHttpTranscriber({ endpoint: 'https://speech.test/x', fetch: fetchStub });

    assert.equal(await transcriber.transcribe({ kind: 'voice', token: 'mid.abcdef' }), undefined);
    assert.equal(calls.length, 0);
  });

  it('фотография в службу распознавания не уходит', async () => {
    const { fetchStub, calls } = stub({});
    const transcriber = createHttpTranscriber({ endpoint: 'https://speech.test/x', fetch: fetchStub });

    assert.equal(await transcriber.transcribe({ kind: 'photo', token: 'https://files.max.test/a.jpg' }), undefined);
    assert.equal(calls.length, 0);
  });

  it('слишком большая запись не скачивается', async () => {
    const { fetchStub, calls } = stub({ recording: { contentLength: String(50 * 1024 * 1024) } });
    const transcriber = createHttpTranscriber({ endpoint: 'https://speech.test/x', fetch: fetchStub });

    assert.equal(await transcriber.transcribe(VOICE), undefined);
    assert.equal(calls.length, 1, 'до распознавания дело не дошло');
  });

  it('запись, оказавшаяся больше заявленного, тоже не проходит', async () => {
    const { fetchStub, calls } = stub({ recording: { bytes: new Uint8Array(21 * 1024 * 1024) } });
    const transcriber = createHttpTranscriber({ endpoint: 'https://speech.test/x', fetch: fetchStub });

    assert.equal(await transcriber.transcribe(VOICE), undefined);
    assert.equal(calls.length, 1);
  });

  it('недоступная запись расшифровки не даёт', async () => {
    const { fetchStub, calls } = stub({ recording: { status: 404 } });
    const transcriber = createHttpTranscriber({ endpoint: 'https://speech.test/x', fetch: fetchStub });

    assert.equal(await transcriber.transcribe(VOICE), undefined);
    assert.equal(calls.length, 1);
  });

  it('отказ службы сообщается наружу, но заявку не ломает', async () => {
    const errors: unknown[] = [];
    const { fetchStub } = stub({ answer: { status: 503 } });

    const transcriber = createHttpTranscriber({
      endpoint: 'https://speech.test/x',
      fetch: fetchStub,
      onError: (error) => errors.push(error),
    });

    assert.equal(await transcriber.transcribe(VOICE), undefined);
    assert.equal(errors.length, 1);
  });

  it('пустая расшифровка не подменяет описание пустой строкой', async () => {
    const { fetchStub } = stub({ answer: { text: '   ' } });
    const transcriber = createHttpTranscriber({ endpoint: 'https://speech.test/x', fetch: fetchStub });

    assert.equal(await transcriber.transcribe(VOICE), undefined);
  });

  it('ответ без текста понимается как «не распознали»', async () => {
    const { fetchStub } = stub({ answer: { text: 42 } });
    const transcriber = createHttpTranscriber({ endpoint: 'https://speech.test/x', fetch: fetchStub });

    assert.equal(await transcriber.transcribe(VOICE), undefined);
  });

  it('обрыв связи не поднимается выше адаптера', async () => {
    const errors: unknown[] = [];
    const { fetchStub } = stub({
      onSecond: () => {
        throw new Error('сеть отвалилась');
      },
    });

    const transcriber = createHttpTranscriber({
      endpoint: 'https://speech.test/x',
      fetch: fetchStub,
      onError: (error) => errors.push(error),
    });

    assert.equal(await transcriber.transcribe(VOICE), undefined);
    assert.equal(errors.length, 1);
  });

  it('ожидание ограничено: служба, которая молчит, заявку не держит', async () => {
    let aborted = false;

    const hanging = (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('прервано по времени'));
        });
      });

    const transcriber = createHttpTranscriber({
      endpoint: 'https://speech.test/x',
      fetch: hanging,
      timeoutMs: 10,
    });

    assert.equal(await transcriber.transcribe(VOICE), undefined);
    assert.equal(aborted, true);
  });
});

describe('распознавание из настроек', () => {
  it('без адреса службы продукт работает без расшифровки', () => {
    assert.equal(transcriberFromEnv({}), undefined);
  });

  it('язык по умолчанию, русский', async () => {
    const { fetchStub, calls } = stub({ answer: { text: 'Течёт кран' } });
    const transcriber = transcriberFromEnv({ SPEECH_URL: 'https://speech.test/x' });

    assert.ok(transcriber);

    const withStub = createHttpTranscriber({ endpoint: 'https://speech.test/x', language: 'ru', fetch: fetchStub });

    assert.equal(await withStub.transcribe(VOICE), 'Течёт кран');
    assert.equal((calls[1]?.body as FormData).get('language'), 'ru');
  });
});
