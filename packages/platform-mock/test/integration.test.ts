import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { Bot, ScenarioEngine, defineScenario, transition } from '@maxkit/max-bot-api';
import { createBotSupervisor, installResilientApi, MemoryMarkerStore, scenarioRecovery } from '@maxkit/runtime';
import { DistributedLock, KeyValueSessionStore, MemoryKeyValueClient, distributedSession } from '@maxkit/sessions';

import { type MockPlatform, startMockPlatform } from '../dist/index.js';

const TOKEN = 'integration-token';

/** Сквозная проверка связки против эмулятора платформы, включая сбои. */
describe('связка пакетов на живом сценарии', () => {
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

  /** Сценарий приёма заявки: адрес, затем описание проблемы. */
  const createRequestScenario = defineScenario<never, { address: string; problem: string }>()<
    'ask-address' | 'read-address' | 'read-problem'
  >({
    id: 'request',
    initialStep: 'ask-address',
    createData: () => ({ address: '', problem: '' }),
    steps: {
      'ask-address': async ({ ctx }) => {
        await (ctx as { reply: (text: string) => Promise<unknown> }).reply('Назовите адрес');
        return transition.goto('read-address');
      },
      'read-address': async ({ ctx }) => {
        const context = ctx as { message: { body: { text: string } }; reply: (t: string) => Promise<unknown> };
        await context.reply('Что случилось?');
        return transition.goto('read-problem', { address: context.message.body.text });
      },
      'read-problem': async ({ ctx, data }) => {
        const context = ctx as { message: { body: { text: string } }; reply: (t: string) => Promise<unknown> };
        await context.reply(`Заявка принята: ${data.address}, ${context.message.body.text}`);
        return transition.complete();
      },
    },
  });

  const buildBot = async () => {
    const bot = new Bot(TOKEN, { clientOptions: { baseUrl: platform.url } });

    installResilientApi(bot, TOKEN, {
      baseUrl: platform.url,
      rateLimit: { rps: 30 },
      retry: { attempts: 4, baseDelayMs: 1, jitter: false },
      timeoutMs: 1000,
    });

    const keyValue = new MemoryKeyValueClient();
    const engine = new ScenarioEngine({ onInconsistentState: 'reset' });
    engine.register(createRequestScenario as never);

    bot.use(scenarioRecovery() as never);
    bot.use(
      distributedSession({
        store: new KeyValueSessionStore<object>(keyValue),
        lock: new DistributedLock(keyValue, { retryDelayMs: 1 }),
        defaultSession: () => ({}),
      }) as never,
    );
    bot.use(engine.middleware() as never);
    bot.command('start', (ctx) => (ctx as never as { scenario: { start: (d: unknown) => Promise<void> } }).scenario.start(createRequestScenario));

    bot.botInfo = await bot.api.getMyInfo();
    return bot;
  };

  it('проводит пользователя через все шаги сценария', async () => {
    const bot = await buildBot();
    const supervisor = createBotSupervisor(bot, { markerStore: new MemoryMarkerStore(), timeoutSeconds: 1 });
    void supervisor.start();

    platform.userSends('/start');
    await platform.waitForOutgoing(1, 3000);

    platform.userSends('Ленина, 15, кв. 3');
    await platform.waitForOutgoing(2, 3000);

    platform.userSends('не работает лифт');
    const sent = await platform.waitForOutgoing(3, 3000);

    await supervisor.stop();

    assert.deepEqual(
      sent.map((message) => message.text),
      ['Назовите адрес', 'Что случилось?', 'Заявка принята: Ленина, 15, кв. 3, не работает лифт'],
    );
  });

  it('сценарий переживает сбои платформы между шагами', async () => {
    const bot = await buildBot();
    const supervisor = createBotSupervisor(bot, {
      markerStore: new MemoryMarkerStore(),
      timeoutSeconds: 1,
      backoff: { baseDelayMs: 1, jitter: false },
    });
    void supervisor.start();

    platform.userSends('/start');
    await platform.waitForOutgoing(1, 3000);

    platform.chaos.failNext(429, { times: 2, path: 'messages', retryAfterSeconds: 0 });
    platform.chaos.abortNext({ times: 1, path: 'updates' });

    platform.userSends('Ленина, 15, кв. 3');
    await platform.waitForOutgoing(2, 5000);

    platform.userSends('не работает лифт');
    const sent = await platform.waitForOutgoing(3, 5000);

    await supervisor.stop();

    assert.equal(sent[2]?.text, 'Заявка принята: Ленина, 15, кв. 3, не работает лифт');
    assert.equal(platform.chaos.pending, 0, 'все запрограммированные сбои случились');
  });

  it('два сообщения подряд от одного жильца не меняются местами', async () => {
    const bot = await buildBot();
    const supervisor = createBotSupervisor(bot, { markerStore: new MemoryMarkerStore(), timeoutSeconds: 1 });
    void supervisor.start();

    platform.userSends('/start');
    await platform.waitForOutgoing(1, 3000);

    platform.userSends('Ленина, 15, кв. 3');
    platform.userSends('не работает лифт');

    const sent = await platform.waitForOutgoing(3, 5000);
    await supervisor.stop();

    assert.equal(sent[1]?.text, 'Что случилось?');
    assert.equal(sent[2]?.text, 'Заявка принята: Ленина, 15, кв. 3, не работает лифт');
  });

  it('разные жильцы не мешают друг другу', async () => {
    const bot = await buildBot();
    const supervisor = createBotSupervisor(bot, { markerStore: new MemoryMarkerStore(), timeoutSeconds: 1 });
    void supervisor.start();

    const first = { userId: 100, chatId: 100 };
    const second = { userId: 200, chatId: 200 };

    platform.userSends('/start', first);
    platform.userSends('/start', second);
    await platform.waitForOutgoing(2, 3000);

    platform.userSends('Ленина, 15', first);
    platform.userSends('Мира, 7', second);
    await platform.waitForOutgoing(4, 3000);

    platform.userSends('течёт кран', first);
    platform.userSends('нет отопления', second);
    await platform.waitForOutgoing(6, 5000);

    await supervisor.stop();

    const byChat = (chatId: number) => platform.outgoing.filter((message) => message.chatId === chatId);

    assert.equal(byChat(100).at(-1)?.text, 'Заявка принята: Ленина, 15, течёт кран');
    assert.equal(byChat(200).at(-1)?.text, 'Заявка принята: Мира, 7, нет отопления');
  });

  it('состояние сценария переживает перезапуск бота', async () => {
    const marker = new MemoryMarkerStore();

    const first = await buildBot();
    const firstSupervisor = createBotSupervisor(first, { markerStore: marker, timeoutSeconds: 1 });
    void firstSupervisor.start();

    platform.userSends('/start');
    await platform.waitForOutgoing(1, 3000);
    await firstSupervisor.stop();

    const second = await buildBot();
    const secondSupervisor = createBotSupervisor(second, { markerStore: marker, timeoutSeconds: 1 });
    void secondSupervisor.start();

    platform.userSends('/start');
    const sent = await platform.waitForOutgoing(2, 3000);
    await secondSupervisor.stop();

    assert.equal(sent[1]?.text, 'Назовите адрес');
  });
});
