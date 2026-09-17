import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MemoryMarkerStore,
  UpdateSupervisor,
  WebhookReceiver,
  createResilientClient,
  resolveRetryOptions,
  type FetchUpdatesResult,
  type UpdateLike,
} from '../dist/index.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const waitFor = async (predicate: () => boolean, message = 'условие не наступило'): Promise<void> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(message);
};

const update = (chatId: number, text: string): UpdateLike => ({
  update_type: 'message_created',
  timestamp: 1,
  message: { recipient: { chat_id: chatId }, body: { text, mid: `mid.${text}` } },
});

describe('ответ без маркера', () => {
  it('позиция сдвигается на число апдейтов, а пачка не обрабатывается повторно', async () => {
    const handled: string[] = [];
    const markers: (number | undefined)[] = [];

    const supervisor = new UpdateSupervisor({
      fetchUpdates: async ({ marker, signal }): Promise<FetchUpdatesResult> => {
        markers.push(marker);

        if (markers.length === 1) return { updates: [update(1, 'раз'), update(1, 'два')] };

        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { updates: [] };
      },
      handleUpdate: async (item) => {
        handled.push(String((item['message'] as { body: { text: string } }).body.text));
      },
      markerStore: new MemoryMarkerStore(),
    });

    void supervisor.start();
    await waitFor(() => markers.length >= 2);
    await supervisor.stop();

    assert.deepEqual(handled, ['раз', 'два']);
    assert.equal(markers[0], undefined, 'первый запрос без позиции');
    assert.equal(markers[1], 3, 'позиция сдвинулась на два апдейта');
    assert.equal(supervisor.stats.processed, 2, 'пачка обработана ровно один раз');
  });

  it('пустой ответ без маркера позицию не двигает', async () => {
    const markers: (number | undefined)[] = [];

    const supervisor = new UpdateSupervisor({
      fetchUpdates: async ({ marker }) => {
        markers.push(marker);
        return { updates: [] };
      },
      handleUpdate: async () => undefined,
    });

    void supervisor.start();
    await waitFor(() => markers.length >= 3);
    await supervisor.stop();

    assert.ok(
      markers.every((value) => value === undefined),
      'без апдейтов позиция остаётся прежней',
    );
  });
});

describe('защита от занятого ожидания', () => {
  it('мгновенно отвечающий источник не душит очередь событий', async () => {
    let iterations = 0;
    let timerFired = false;

    const supervisor = new UpdateSupervisor({
      fetchUpdates: async () => {
        iterations += 1;
        return { updates: [] };
      },
      handleUpdate: async () => undefined,
    });

    setTimeout(() => {
      timerFired = true;
    }, 5);

    void supervisor.start();
    await waitFor(() => timerFired, 'таймер не сработал: цикл занял очередь событий целиком');
    await supervisor.stop();

    assert.ok(iterations > 1, 'цикл при этом продолжал работать');
  });
});

describe('границы настроек повторов', () => {
  it('число попыток не может быть меньше одной', () => {
    assert.equal(resolveRetryOptions({ attempts: 0 }).attempts, 1);
    assert.equal(resolveRetryOptions({ attempts: -5 }).attempts, 1);
    assert.equal(resolveRetryOptions({ attempts: 2.7 }).attempts, 2);
  });

  it('запрос уходит даже при нулевом числе попыток', async () => {
    let calls = 0;
    const client = createResilientClient('token', {
      rateLimit: false,
      retry: { attempts: 0 },
      fetch: (() => {
        calls += 1;
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      }) as unknown as typeof globalThis.fetch,
    });

    const result = await client.call({ method: 'me', options: {} });

    assert.equal(calls, 1);
    assert.equal(result.status, 200);
  });
});

describe('кеш повторной доставки', () => {
  it('не растёт сверх заданного предела', async () => {
    let now = 1_000_000;
    const receiver = new WebhookReceiver({
      secret: 'plain-secret',
      handleUpdate: async () => undefined,
      dedupe: { ttlMs: 60_000, max: 10 },
      now: () => now,
    });

    for (let index = 0; index < 200; index += 1) {
      now += 1;
      receiver.receive(JSON.stringify(update(index, `сообщение-${index}`)), 'plain-secret');
    }

    await receiver.drain();

    assert.equal(receiver.stats.accepted, 200);
    assert.equal(receiver.stats.duplicates, 0, 'разные апдейты дублями не считаются');
  });

  it('дубль остаётся дублём, пока не истёк срок', async () => {
    let now = 1_000_000;
    const receiver = new WebhookReceiver({
      secret: 'plain-secret',
      handleUpdate: async () => undefined,
      dedupe: { ttlMs: 1000, max: 5 },
      now: () => now,
    });

    const payload = JSON.stringify(update(1, 'повтор'));

    receiver.receive(payload, 'plain-secret');
    now += 500;
    receiver.receive(payload, 'plain-secret');
    await receiver.drain();

    assert.equal(receiver.stats.duplicates, 1);
    assert.equal(receiver.stats.accepted, 1);
  });
});
