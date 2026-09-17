import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { Bot } from '@maxkit/max-bot-api';
import { createBotSupervisor, installResilientApi, MemoryMarkerStore } from '@maxkit/runtime';

import { Chaos, type MockPlatform, startMockPlatform } from '../dist/index.js';

const TOKEN = 'test-token';

describe('Chaos', () => {
  it('расходует правила по одному на запрос', () => {
    const chaos = new Chaos();
    chaos.failNext(429, { times: 2 });

    assert.equal(chaos.pending, 2);
    assert.deepEqual(chaos.take('messages')?.kind, 'status');
    assert.deepEqual(chaos.take('messages')?.kind, 'status');
    assert.equal(chaos.take('messages'), undefined);
  });

  it('ограничивает правило путём', () => {
    const chaos = new Chaos();
    chaos.failNext(500, { path: 'messages' });

    assert.equal(chaos.take('updates'), undefined, 'опрос апдейтов не задет');
    assert.notEqual(chaos.take('messages'), undefined);
  });

  it('сбрасывается целиком', () => {
    const chaos = new Chaos();
    chaos.hangNext({ times: 5 });
    chaos.reset();

    assert.equal(chaos.pending, 0);
  });
});

describe('эмулятор платформы', () => {
  let platform: MockPlatform;

  before(async () => {
    platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 200 });
  });

  after(async () => {
    await platform.stop();
  });

  beforeEach(() => {
    platform.reset();
  });

  const request = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${platform.url}/${path}`, { headers: { Authorization: TOKEN }, ...init });

  it('отдаёт сведения о боте', async () => {
    const response = await request('me');
    const body = (await response.json()) as { user_id: number; is_bot: boolean };

    assert.equal(response.status, 200);
    assert.equal(body.is_bot, true);
  });

  it('требует токен', async () => {
    const response = await fetch(`${platform.url}/me`);
    const body = (await response.json()) as { code: string };

    assert.equal(response.status, 401);
    assert.equal(body.code, 'verify.token');
  });

  it('отвечает как платформа на неизвестный путь', async () => {
    const response = await request('chatz');
    const body = (await response.json()) as { code: string; message: string };

    assert.equal(response.status, 404);
    assert.equal(body.code, 'not.found');
    assert.match(body.message, /not recognized/);
  });

  it('отдаёт апдейты по маркеру и продвигает позицию', async () => {
    platform.userSends('первое');
    platform.userSends('второе');

    const first = (await (await request('updates?marker=1&limit=1')).json()) as {
      updates: { message: { body: { text: string } } }[];
      marker: number;
    };

    assert.equal(first.updates.length, 1);
    assert.equal(first.updates[0]?.message.body.text, 'первое');
    assert.equal(first.marker, 2);

    const second = (await (await request(`updates?marker=${first.marker}`)).json()) as {
      updates: { message: { body: { text: string } } }[];
    };

    assert.equal(second.updates[0]?.message.body.text, 'второе');
  });

  it('повторный запрос с тем же маркером отдаёт ту же пачку', async () => {
    platform.userSends('заявка');

    const first = (await (await request('updates?marker=1')).json()) as { updates: unknown[] };
    const again = (await (await request('updates?marker=1')).json()) as { updates: unknown[] };

    assert.equal(first.updates.length, 1);
    assert.deepEqual(again.updates, first.updates, 'без подтверждения маркера апдейт не теряется');
  });

  it('долгий опрос дожидается апдейта', async () => {
    const pending = request('updates?marker=1&timeout=5');
    setTimeout(() => platform.userSends('пришло позже'), 20);

    const body = (await (await pending).json()) as { updates: { message: { body: { text: string } } }[] };

    assert.equal(body.updates[0]?.message.body.text, 'пришло позже');
  });

  it('записывает отправленные ботом сообщения', async () => {
    await request('messages?chat_id=2001', {
      method: 'POST',
      headers: { Authorization: TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Заявка принята' }),
    });

    assert.equal(platform.outgoing.length, 1);
    assert.equal(platform.outgoing[0]?.text, 'Заявка принята');
    assert.equal(platform.outgoing[0]?.chatId, 2001);
  });

  it('выдаёт запрограммированную ошибку', async () => {
    platform.chaos.failNext(429, { retryAfterSeconds: 3 });

    const response = await request('me');

    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '3');
  });
});

describe('бот на официальном SDK против эмулятора', () => {
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

  const buildBot = async () => {
    const bot = new Bot(TOKEN, { clientOptions: { baseUrl: platform.url } });
    installResilientApi(bot, TOKEN, {
      baseUrl: platform.url,
      rateLimit: false,
      retry: { attempts: 4, baseDelayMs: 1, jitter: false },
      timeoutMs: 500,
    });

    bot.botInfo = await bot.api.getMyInfo();
    return bot;
  };

  it('отвечает на сообщение пользователя', async () => {
    const bot = await buildBot();
    bot.on('message_created', (ctx) => ctx.reply(`Принято: ${ctx.message.body.text}`));

    const supervisor = createBotSupervisor(bot, { markerStore: new MemoryMarkerStore(), timeoutSeconds: 1 });
    void supervisor.start();

    platform.userSends('течёт кран');
    const [sent] = await platform.waitForOutgoing(1);
    await supervisor.stop();

    assert.equal(sent?.text, 'Принято: течёт кран');
  });

  it('доставляет ответ, несмотря на 429 от платформы', async () => {
    const bot = await buildBot();
    bot.on('message_created', (ctx) => ctx.reply('Заявка зарегистрирована'));

    const supervisor = createBotSupervisor(bot, { markerStore: new MemoryMarkerStore(), timeoutSeconds: 1 });
    void supervisor.start();

    platform.chaos.failNext(429, { times: 2, path: 'messages', retryAfterSeconds: 0 });
    platform.userSends('нет горячей воды');

    const [sent] = await platform.waitForOutgoing(1, 3000);
    await supervisor.stop();

    assert.equal(sent?.text, 'Заявка зарегистрирована');

    const attempts = platform.requests.filter((entry) => entry.path === 'messages' && entry.method === 'POST');
    assert.equal(attempts.length, 1, 'до обработчика дошла только успешная попытка');
  });

  it('переживает обрыв соединения при опросе апдейтов', async () => {
    const bot = await buildBot();
    bot.on('message_created', (ctx) => ctx.reply('на связи'));

    const supervisor = createBotSupervisor(bot, {
      markerStore: new MemoryMarkerStore(),
      timeoutSeconds: 1,
      backoff: { baseDelayMs: 1, jitter: false },
    });
    void supervisor.start();

    platform.chaos.abortNext({ times: 2, path: 'updates' });
    platform.userSends('лифт застрял');

    const [sent] = await platform.waitForOutgoing(1, 3000);
    await supervisor.stop();

    assert.equal(sent?.text, 'на связи');
    assert.equal(platform.chaos.pending, 0, 'оба обрыва случились');
    assert.equal(supervisor.stats.fetchErrors, 0);
  });

  it('цикл выживает, когда транспорт исчерпал повторы', async () => {
    const bot = await buildBot();
    bot.on('message_created', (ctx) => ctx.reply('всё ещё жив'));

    installResilientApi(bot, TOKEN, {
      baseUrl: platform.url,
      rateLimit: false,
      retry: { attempts: 1 },
      timeoutMs: 500,
    });

    const supervisor = createBotSupervisor(bot, {
      markerStore: new MemoryMarkerStore(),
      timeoutSeconds: 1,
      backoff: { baseDelayMs: 1, jitter: false },
    });
    void supervisor.start();

    platform.chaos.abortNext({ times: 2, path: 'updates' });
    platform.userSends('лифт застрял');

    const [sent] = await platform.waitForOutgoing(1, 3000);
    await supervisor.stop();

    assert.equal(sent?.text, 'всё ещё жив');
    assert.ok(supervisor.stats.fetchErrors >= 1, 'сбои учтены, и цикл продолжил работу');
  });

  it('ошибка обработчика не мешает следующим апдейтам', async () => {
    const bot = await buildBot();
    bot.on('message_created', (ctx) => {
      if (ctx.message.body.text === 'ядовитое') throw new Error('падение обработчика');
      return ctx.reply('обработано');
    });

    const errors: unknown[] = [];
    const supervisor = createBotSupervisor(bot, {
      markerStore: new MemoryMarkerStore(),
      timeoutSeconds: 1,
      onHandlerError: (error) => void errors.push(error),
    });
    void supervisor.start();

    platform.userSends('ядовитое');
    platform.userSends('обычное');

    const [sent] = await platform.waitForOutgoing(1, 3000);
    await supervisor.stop();

    assert.equal(sent?.text, 'обработано');
    assert.equal(errors.length, 1);
  });

  it('после перезапуска не переобрабатывает подтверждённые апдейты', async () => {
    const store = new MemoryMarkerStore();

    const first = await buildBot();
    first.on('message_created', (ctx) => ctx.reply('первый ответ'));
    const firstSupervisor = createBotSupervisor(first, { markerStore: store, timeoutSeconds: 1 });
    void firstSupervisor.start();

    platform.userSends('заявка');
    await platform.waitForOutgoing(1);
    await firstSupervisor.stop();

    const second = await buildBot();
    second.on('message_created', (ctx) => ctx.reply('второй ответ'));
    const secondSupervisor = createBotSupervisor(second, { markerStore: store, timeoutSeconds: 1 });
    void secondSupervisor.start();

    await new Promise((resolve) => setTimeout(resolve, 300));
    await secondSupervisor.stop();

    assert.equal(platform.outgoing.length, 1, 'старый апдейт не обработан повторно');
  });
});
