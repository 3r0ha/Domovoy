import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

import { type MockPlatform, startMockPlatform } from '../dist/index.js';

const TOKEN = 'endpoints-token';

describe('методы Bot API у эмулятора', () => {
  let platform: MockPlatform;

  before(async () => {
    platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });
  });

  after(async () => {
    await platform.stop();
  });

  beforeEach(() => {
    platform.reset();
  });

  const call = async (
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await fetch(`${platform.url}/${path}`, {
      headers: { Authorization: TOKEN, 'content-type': 'application/json' },
      ...init,
    });

    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it('сохраняет команды бота', async () => {
    const result = await call('me/commands', {
      method: 'PATCH',
      body: JSON.stringify({ commands: [{ name: 'start', description: 'Начать' }] }),
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body['commands'], [{ name: 'start', description: 'Начать' }]);
  });

  it('отвечает на чтение, правку и удаление сообщений', async () => {
    assert.deepEqual((await call('messages')).body, { messages: [] });
    assert.equal((await call('messages', { method: 'PUT', body: '{}' })).status, 200);
    assert.equal((await call('messages', { method: 'DELETE' })).status, 200);
  });

  it('принимает ответ на нажатие кнопки', async () => {
    const result = await call('answers', { method: 'POST', body: JSON.stringify({ notification: 'Готово' }) });

    assert.equal(result.status, 200);
    assert.equal(result.body['success'], true);
  });

  it('ведёт список подписок на вебхук', async () => {
    await call('subscriptions', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.test/hook', secret: 's3cret' }),
    });

    const list = (await call('subscriptions')).body['subscriptions'] as { url: string }[];
    assert.deepEqual(list.map((item) => item.url), ['https://example.test/hook']);

    await call('subscriptions?url=https%3A%2F%2Fexample.test%2Fhook', { method: 'DELETE' });
    assert.deepEqual((await call('subscriptions')).body['subscriptions'], []);
  });

  it('отдаёт чаты и сведения о чате', async () => {
    assert.deepEqual((await call('chats')).body, { chats: [], marker: null });

    const chat = (await call('chats/42')).body;
    assert.equal(chat['chat_id'], 42);
  });

  it('принимает действия в чате', async () => {
    const result = await call('chats/42/actions', { method: 'POST', body: JSON.stringify({ action: 'typing_on' }) });

    assert.equal(result.status, 200);
  });

  it('выдаёт адрес для загрузки файла', async () => {
    const result = await call('uploads?type=image', { method: 'POST', body: '{}' });

    assert.equal(result.status, 200);
    assert.match(String(result.body['url']), /image$/);
    assert.equal(result.body['token'], 'upload-token-image');
  });

  it('журнал запросов виден снаружи', async () => {
    await call('me');

    const last = platform.requests.at(-1);
    assert.equal(last?.path, 'me');
    assert.equal(last?.method, 'GET');
  });
});

describe('сценарные события эмулятора', () => {
  let platform: MockPlatform;

  before(async () => {
    platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });
  });

  after(async () => {
    await platform.stop();
  });

  beforeEach(() => {
    platform.reset();
  });

  const updates = async (): Promise<Record<string, unknown>[]> => {
    const response = await fetch(`${platform.url}/updates?marker=1`, { headers: { Authorization: TOKEN } });
    const body = (await response.json()) as { updates: Record<string, unknown>[] };
    return body.updates;
  };

  it('нажатие кнопки приходит как message_callback', async () => {
    platform.userPressesButton('request:accept', { userId: 55, chatId: 66 });

    const [update] = await updates();
    assert.equal(update?.['update_type'], 'message_callback');

    const callback = update?.['callback'] as { payload: string; user: { user_id: number } };
    assert.equal(callback.payload, 'request:accept');
    assert.equal(callback.user.user_id, 55);
  });

  it('запуск бота приходит как bot_started', async () => {
    platform.botStarted({ userId: 77, chatId: 88 });

    const [update] = await updates();
    assert.equal(update?.['update_type'], 'bot_started');
    assert.equal(update?.['chat_id'], 88);
  });

  it('произвольный апдейт можно положить целиком', async () => {
    platform.pushUpdate({ update_type: 'chat_title_changed', timestamp: 1, chat_id: 5, title: 'Дом 15' });

    const [update] = await updates();
    assert.equal(update?.['title'], 'Дом 15');
  });

  it('ожидание ответа завершается ошибкой с понятным текстом', async () => {
    await assert.rejects(platform.waitForOutgoing(1, 50), /отправил 0 сообщений из ожидаемых 1/);
  });
});

describe('доставка на вебхук', () => {
  let platform: MockPlatform;
  let hook: Server;
  let hookUrl: string;
  let delivered: { body: string; secret: string | undefined }[] = [];

  before(async () => {
    platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });

    hook = createServer((request: IncomingMessage, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        delivered.push({
          body: Buffer.concat(chunks).toString('utf8'),
          secret: request.headers['x-max-bot-api-secret'] as string | undefined,
        });
        response.writeHead(200).end('OK');
      });
    });

    await new Promise<void>((resolve) => hook.listen(0, '127.0.0.1', () => resolve()));
    const address = hook.address();
    if (address === null || typeof address === 'string') throw new Error('вебхук не поднялся');
    hookUrl = `http://127.0.0.1:${address.port}/hook`;
  });

  after(async () => {
    hook.closeAllConnections();
    await new Promise<void>((resolve) => hook.close(() => resolve()));
    await platform.stop();
  });

  beforeEach(() => {
    platform.reset();
    delivered = [];
  });

  it('апдейт уходит подписчику вместе с секретом', async () => {
    await fetch(`${platform.url}/subscriptions`, {
      method: 'POST',
      headers: { Authorization: TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ url: hookUrl, secret: 'hook-secret' }),
    });

    platform.userSends('течёт кран');

    for (let attempt = 0; attempt < 200 && delivered.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]?.secret, 'hook-secret');
    assert.match(delivered[0]?.body ?? '', /течёт кран/);
  });

  it('недоступный вебхук не роняет эмулятор', async () => {
    await fetch(`${platform.url}/subscriptions`, {
      method: 'POST',
      headers: { Authorization: TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:1/never' }),
    });

    assert.doesNotThrow(() => platform.userSends('в никуда'));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

describe('программируемые задержки', () => {
  it('задержка откладывает ответ, но не отменяет его', async () => {
    const platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });
    platform.chaos.delayNext(60, { path: 'me' });

    const started = Date.now();
    const response = await fetch(`${platform.url}/me`, { headers: { Authorization: TOKEN } });

    assert.equal(response.status, 200);
    assert.ok(Date.now() - started >= 50, 'ответ пришёл не раньше заданной задержки');

    await platform.stop();
  });

  it('зависший запрос обрывается остановкой эмулятора', async () => {
    const platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });
    platform.chaos.hangNext({ path: 'me' });

    const controller = new AbortController();
    const pending = fetch(`${platform.url}/me`, {
      headers: { Authorization: TOKEN },
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await assert.rejects(pending);
    await platform.stop();
  });
});
