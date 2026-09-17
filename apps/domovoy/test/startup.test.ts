import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { startMockPlatform, type MockPlatform } from '@maxkit/platform-mock';

/** Проверка точки сборки целиком. */
const TOKEN = 'startup-token';
const MAIN = fileURLToPath(new URL('../dist/main.js', import.meta.url));

/** Свободный порт: система выдаёт его сама, мы только запоминаем номер. */
const freePort = async (): Promise<number> => {
  const probe = createServer();

  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));

  const address = probe.address();

  if (address === null || typeof address === 'string') throw new Error('не удалось занять порт');

  const { port: chosen } = address;

  await new Promise<void>((resolve) => probe.close(() => resolve()));

  return chosen;
};

const waitFor = async (probe: () => Promise<boolean>, timeoutMs: number, message: string): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) assert.fail(message);

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

describe('запуск продукта', () => {
  let platform: MockPlatform;
  let process_: ChildProcess;
  let stateDir: string;
  let port: number;
  let output = '';

  before(async () => {
    platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });
    stateDir = await mkdtemp(join(tmpdir(), 'domovoy-startup-'));

    port = await freePort();

    process_ = spawn(globalThis.process.execPath, [MAIN], {
      env: {
        ...globalThis.process.env,
        BOT_TOKEN: TOKEN,
        MAX_API_URL: platform.url,
        PORT: String(port),
        DEFAULT_BUILDING_ID: 'b1',
        MARKER_FILE: join(stateDir, 'marker'),
        DATABASE_URL: '',
        REDIS_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    process_.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    process_.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  });

  after(async () => {
    process_.kill('SIGTERM');
    await new Promise((resolve) => process_.once('exit', resolve));
    await platform.stop();
    await rm(stateDir, { recursive: true, force: true });
  });

  it('поднимает API и отвечает на проверку живости', async () => {
    await waitFor(
      async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`);
          return response.status === 200;
        } catch {
          return false;
        }
      },
      15_000,
      `API не поднялся. Вывод процесса:\n${output}`,
    );

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    assert.deepEqual(await response.json(), { status: 'ok', storage: 'ok' });
  });

  it('бот в том же процессе принимает апдейты', async () => {
    platform.userSends('/start', { userId: 4242, chatId: 4242 });

    await waitFor(
      async () => Promise.resolve(platform.outgoing.some((message) => /Здравствуйте/.test(message.text))),
      15_000,
      `Бот не ответил. Вывод процесса:\n${output}`,
    );
  });

  it('без адреса мини-приложения предупреждает, а не молчит', () => {
    assert.match(output, /ALLOWED_ORIGINS не задан/);
  });

  it('без поставщиков оплата и домофония не подключаются', async () => {
    assert.match(output, /PAYMENTS не задан/);
    assert.match(output, /HUB не задан/);

    const response = await fetch(`http://127.0.0.1:${port}/api/hub/alarm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ buildingId: 'b1', deviceId: 'leak-1' }),
    });

    assert.equal(response.status, 404, 'без секрета домофонии маршрута нет вовсе');
  });
});

/** Боевой режим платформы: апдейты приходят запросом, а не забираются опросом. */
describe('запуск в режиме вебхука', () => {
  let platform: MockPlatform;
  let process_: ChildProcess;
  let stateDir: string;
  let port: number;
  let output = '';

  before(async () => {
    platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });
    stateDir = await mkdtemp(join(tmpdir(), 'domovoy-webhook-'));
    port = await freePort();

    process_ = spawn(globalThis.process.execPath, [MAIN], {
      env: {
        ...globalThis.process.env,
        BOT_TOKEN: TOKEN,
        MAX_API_URL: platform.url,
        PORT: String(port),
        DEFAULT_BUILDING_ID: 'b1',
        MARKER_FILE: join(stateDir, 'marker'),
        WEBHOOK_URL: `http://127.0.0.1:${port}/bot/updates`,
        WEBHOOK_SECRET: 'startup-webhook-secret',
        DATABASE_URL: '',
        REDIS_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    process_.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    process_.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  });

  after(async () => {
    process_.kill('SIGTERM');
    await new Promise((resolve) => process_.once('exit', resolve));
    await platform.stop();
    await rm(stateDir, { recursive: true, force: true });
  });

  it('подписывается у платформы на свой адрес', async () => {
    await waitFor(
      async () => Promise.resolve(output.includes('Апдейты приходят на')),
      15_000,
      `Подписка не оформлена. Вывод процесса:\n${output}`,
    );

    const subscriptions = await (
      await fetch(`${platform.url}/subscriptions`, { headers: { authorization: TOKEN } })
    ).json();

    assert.deepEqual(
      (subscriptions as { subscriptions: { url: string }[] }).subscriptions.map((item) => item.url),
      [`http://127.0.0.1:${port}/bot/updates`],
    );
  });

  it('отвечает на сообщение, доставленное платформой на вебхук', async () => {
    platform.userSends('/start', { userId: 5252, chatId: 5252 });

    await waitFor(
      async () => Promise.resolve(platform.outgoing.some((message) => /Здравствуйте/.test(message.text))),
      15_000,
      `Бот не ответил. Вывод процесса:\n${output}`,
    );
  });

  it('чужой запрос на адрес вебхука не принимается', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/bot/updates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update_type: 'message_created', timestamp: Date.now() }),
    });

    assert.equal(response.status, 401);
  });
});

describe('запуск с недоступным Redis', () => {
  let platform: MockPlatform;
  let process_: ChildProcess;
  let stateDir: string;
  let port: number;
  let output = '';

  before(async () => {
    platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });
    stateDir = await mkdtemp(join(tmpdir(), 'domovoy-redis-'));
    port = await freePort();

    const closed = await freePort();

    process_ = spawn(globalThis.process.execPath, [MAIN], {
      env: {
        ...globalThis.process.env,
        BOT_TOKEN: TOKEN,
        MAX_API_URL: platform.url,
        PORT: String(port),
        DEFAULT_BUILDING_ID: 'b1',
        MARKER_FILE: join(stateDir, 'marker'),
        REDIS_URL: `redis://127.0.0.1:${closed}`,
        DATABASE_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    process_.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    process_.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  });

  after(async () => {
    process_.kill('SIGTERM');
    await new Promise((resolve) => process_.once('exit', resolve));
    await platform.stop();
    await rm(stateDir, { recursive: true, force: true });
  });

  it('продукт поднимается и работает на памяти процесса', async () => {
    await waitFor(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/health`)).status === 200;
        } catch {
          return false;
        }
      },
      15_000,
      `API не поднялся. Вывод процесса:\n${output}`,
    );

    assert.match(output, /Redis не отвечает/);

    platform.userSends('/start', { userId: 6262, chatId: 6262 });

    await waitFor(
      async () => Promise.resolve(platform.outgoing.some((message) => /Здравствуйте/.test(message.text))),
      15_000,
      `Бот не ответил. Вывод процесса:\n${output}`,
    );
  });

  it('процесс жив после остановки по сигналу только один раз', async () => {
    assert.equal(process_.exitCode, null, `процесс завершился раньше времени:\n${output}`);
  });
});
