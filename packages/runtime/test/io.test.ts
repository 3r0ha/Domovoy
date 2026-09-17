import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { FileMarkerStore, WebhookReceiver, sleep, toAbortError } from '../dist/index.js';

describe('FileMarkerStore', () => {
  let directory: string;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'maxkit-marker-'));
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('сохраняет и читает позицию', async () => {
    const store = new FileMarkerStore(join(directory, 'simple'));

    await store.save(4242);

    assert.equal(await store.load(), 4242);
  });

  it('переживает перезапуск процесса', async () => {
    const path = join(directory, 'restart');

    await new FileMarkerStore(path).save(777);
    const afterRestart = new FileMarkerStore(path);

    assert.equal(await afterRestart.load(), 777, 'новый экземпляр читает ту же позицию');
  });

  it('без файла отдаёт пустую позицию', async () => {
    const store = new FileMarkerStore(join(directory, 'missing'));

    assert.equal(await store.load(), undefined);
  });

  it('битое содержимое не роняет бота', async () => {
    const path = join(directory, 'broken');
    await writeFile(path, 'не число', 'utf8');

    assert.equal(await new FileMarkerStore(path).load(), undefined);
  });

  it('перезапись обновляет позицию', async () => {
    const store = new FileMarkerStore(join(directory, 'overwrite'));

    await store.save(1);
    await store.save(2);

    assert.equal(await store.load(), 2);
  });

  it('не оставляет временных файлов', async () => {
    const path = join(directory, 'atomic');
    const store = new FileMarkerStore(path);

    await store.save(10);
    await store.save(11);

    const files = await readdir(directory);
    assert.equal(
      files.some((name) => name.endsWith('.tmp')),
      false,
      'запись атомарная: временный файл переименован, а не оставлен рядом',
    );
    assert.equal((await readFile(path, 'utf8')).trim(), '11');
  });

  it('пробелы вокруг числа не мешают', async () => {
    const path = join(directory, 'spaces');
    await writeFile(path, ' 55 \n', 'utf8');

    assert.equal(await new FileMarkerStore(path).load(), 55);
  });
});

describe('HTTP-обработчик вебхука', () => {
  const SECRET = 'webhook-secret-42';
  let server: Server;
  let url: string;
  let handled: string[] = [];

  const receiver = new WebhookReceiver({
    secret: SECRET,
    maxBodyBytes: 256,
    handleUpdate: async (update) => {
      handled.push(String((update['message'] as { body: { text: string } }).body.text));
    },
  });

  const update = (text: string): string =>
    JSON.stringify({
      update_type: 'message_created',
      timestamp: Date.now(),
      message: { recipient: { chat_id: 1 }, body: { mid: `mid.${text}`, text } },
    });

  const post = (body: string, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(url, { method: 'POST', headers: { 'x-max-bot-api-secret': SECRET, ...headers }, body });

  before(async () => {
    server = createServer(receiver.callback());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('сервер не поднялся');
    url = `http://127.0.0.1:${address.port}/webhook`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('принимает апдейт и отвечает сразу', async () => {
    handled = [];

    const response = await post(update('течёт кран'));
    await receiver.drain();

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'OK');
    assert.deepEqual(handled, ['течёт кран']);
  });

  it('не принимает ничего, кроме POST', async () => {
    const response = await fetch(url, { method: 'GET', headers: { 'x-max-bot-api-secret': SECRET } });

    assert.equal(response.status, 405);
  });

  it('отклоняет чужой секрет', async () => {
    const response = await post(update('подделка'), { 'x-max-bot-api-secret': 'another-secret' });

    assert.equal(response.status, 401);
  });

  it('секрет вне ASCII отвергается при создании', () => {
    assert.throws(
      () => new WebhookReceiver({ secret: 'секрет-вебхука', handleUpdate: async () => undefined }),
      /печатаемых символов ASCII/,
    );

    assert.throws(
      () => new WebhookReceiver({ secret: 'с пробелом', handleUpdate: async () => undefined }),
      /печатаемых символов ASCII/,
    );
  });

  it('обрывает чтение слишком большого тела', async () => {
    const response = await post(update('а'.repeat(500)));

    assert.equal(response.status, 413);
  });

  it('отклоняет тело, которое не является апдейтом', async () => {
    const response = await post('{"нет":"апдейта"}');

    assert.equal(response.status, 400);
  });

  it('без секрета тело даже не читается', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-max-bot-api-secret': 'another-secret' },
      body: 'а'.repeat(5000),
    });

    assert.equal(response.status, 401);
  });

  it('оборванное соединение не роняет процесс', async () => {
    const controller = new AbortController();

    const request = fetch(url, {
      method: 'POST',
      headers: { 'x-max-bot-api-secret': SECRET, 'content-length': '5000' },
      body: update('обрыв'),
      signal: controller.signal,
    });

    controller.abort();
    await assert.rejects(request);

    const next = await post(update('после обрыва'));

    assert.equal(next.status, 200);
  });
});

describe('ожидание с отменой', () => {
  it('завершается по времени', async () => {
    const started = Date.now();
    await sleep(20);

    assert.ok(Date.now() - started >= 15);
  });

  it('отклоняется, если сигнал уже отменён', async () => {
    const controller = new AbortController();
    controller.abort(new Error('поздно'));

    await assert.rejects(sleep(1000, controller.signal), /поздно/);
  });

  it('отклоняется при отмене во время ожидания', async () => {
    const controller = new AbortController();
    const pending = sleep(1000, controller.signal);

    setTimeout(() => controller.abort(new Error('передумали')), 5);

    await assert.rejects(pending, /передумали/);
  });

  it('причина отмены всегда приходит ошибкой', () => {
    const wrapped = toAbortError('строка вместо ошибки');

    assert.ok(wrapped instanceof Error);
    assert.equal(wrapped.name, 'AbortError');
    assert.equal(wrapped.cause, 'строка вместо ошибки');

    const original = new Error('своя ошибка');
    assert.equal(toAbortError(original), original, 'готовая ошибка не заворачивается повторно');
  });
});
