import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MemoryMarkerStore,
  OrderedScheduler,
  Semaphore,
  UpdateSupervisor,
  defaultOrderingKey,
  type FetchUpdatesResult,
  type MarkerStore,
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

const message = (chatId: number, text: string): UpdateLike => ({
  update_type: 'message_created',
  timestamp: Date.now(),
  message: { recipient: { chat_id: chatId }, body: { text } },
});

/** Источник апдейтов: отдаёт заготовленные пачки, потом «висит», как настоящий long polling. */
const createFetcher = (batches: FetchUpdatesResult[]) => {
  const markers: (number | undefined)[] = [];
  let index = 0;

  return {
    markers,
    get calls(): number {
      return markers.length;
    },
    fetch: async ({ marker, signal }: { marker?: number; signal: AbortSignal }): Promise<FetchUpdatesResult> => {
      markers.push(marker);

      const batch = batches[index];
      index += 1;
      if (batch) return batch;

      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });

      return { updates: [] };
    },
  };
};

describe('Semaphore', () => {
  it('не выпускает больше задач, чем разрешено', async () => {
    const semaphore = new Semaphore(2);

    const first = await semaphore.acquire();
    const second = await semaphore.acquire();
    assert.equal(semaphore.free, 0);

    let thirdAcquired = false;
    void semaphore.acquire().then(() => {
      thirdAcquired = true;
    });

    await tick();
    assert.equal(thirdAcquired, false, 'третья задача ждёт освобождения слота');

    first();
    await tick();
    assert.equal(thirdAcquired, true);

    second();
  });

  it('повторное освобождение слота ничего не ломает', async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();

    release();
    release();

    assert.equal(semaphore.free, 1);
  });
});

describe('OrderedScheduler', () => {
  it('сохраняет порядок внутри ключа и распараллеливает разные ключи', async () => {
    const scheduler = new OrderedScheduler(4);
    const order: string[] = [];

    const task = (label: string, delay: number) => async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      order.push(label);
    };

    void scheduler.run('a', task('a1', 20));
    void scheduler.run('a', task('a2', 0));
    void scheduler.run('b', task('b1', 0));

    await scheduler.drain();

    assert.deepEqual(order.slice(0, 1), ['b1'], 'чат B не ждёт чат A');
    assert.deepEqual(order.slice(1), ['a1', 'a2'], 'внутри чата A порядок сохранён');
  });

  it('ошибка задачи не рвёт очередь ключа', async () => {
    const scheduler = new OrderedScheduler(2);
    const done: string[] = [];

    const failing = scheduler.run('a', async () => {
      throw new Error('обработчик упал');
    });
    const next = scheduler.run('a', async () => {
      done.push('второй выполнен');
    });

    await assert.rejects(failing, /обработчик упал/);
    await next;
    await scheduler.drain();

    assert.deepEqual(done, ['второй выполнен']);
  });

  it('ограничивает одновременное выполнение', async () => {
    const scheduler = new OrderedScheduler(2);
    let running = 0;
    let peak = 0;

    const task = async (): Promise<void> => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };

    for (let index = 0; index < 6; index += 1) void scheduler.run(`chat-${index}`, task);
    await scheduler.drain();

    assert.equal(peak, 2);
  });
});

describe('ключ упорядочивания', () => {
  it('берёт чат сообщения', () => {
    assert.equal(defaultOrderingKey(message(42, 'привет')), '42');
  });

  it('берёт пользователя из callback', () => {
    const update: UpdateLike = { update_type: 'message_callback', callback: { user: { user_id: 7 } } };
    assert.equal(defaultOrderingKey(update), '7');
  });

  it('не падает на незнакомой форме апдейта', () => {
    assert.equal(defaultOrderingKey({ update_type: 'bot_started' }), 'bot_started:unknown');
  });
});

describe('UpdateSupervisor', () => {
  it('обрабатывает пачку и сохраняет маркер', async () => {
    const fetcher = createFetcher([{ updates: [message(1, 'раз'), message(2, 'два')], marker: 100 }]);
    const store = new MemoryMarkerStore();
    const handled: string[] = [];

    const supervisor = new UpdateSupervisor({
      fetchUpdates: fetcher.fetch,
      handleUpdate: async (update) => {
        handled.push(String((update['message'] as { body: { text: string } }).body.text));
      },
      markerStore: store,
    });

    void supervisor.start();
    await waitFor(() => supervisor.stats.processed === 2);
    await supervisor.stop();

    assert.deepEqual(handled.sort(), ['два', 'раз']);
    assert.equal(store.load(), 100);
    assert.equal(supervisor.stats.marker, 100);
  });

  it('сохраняет маркер только после обработки всей пачки', async () => {
    const events: string[] = [];
    const store: MarkerStore = {
      load: () => undefined,
      save: (marker) => void events.push(`marker:${marker}`),
    };

    const fetcher = createFetcher([{ updates: [message(1, 'раз'), message(2, 'два')], marker: 55 }]);
    const supervisor = new UpdateSupervisor({
      fetchUpdates: fetcher.fetch,
      handleUpdate: async (update) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`handled:${(update['message'] as { recipient: { chat_id: number } }).recipient.chat_id}`);
      },
      markerStore: store,
    });

    void supervisor.start();
    await waitFor(() => events.includes('marker:55'));
    await supervisor.stop();

    assert.equal(events.at(-1), 'marker:55', 'маркер записан последним, после обоих апдейтов');
    assert.equal(events.length, 3);
  });

  it('продолжает с сохранённой позиции после перезапуска', async () => {
    const store = new MemoryMarkerStore();
    store.save(500);

    const fetcher = createFetcher([{ updates: [message(1, 'после рестарта')], marker: 501 }]);
    const supervisor = new UpdateSupervisor({
      fetchUpdates: fetcher.fetch,
      handleUpdate: async () => undefined,
      markerStore: store,
    });

    void supervisor.start();
    await waitFor(() => supervisor.stats.processed === 1);
    await supervisor.stop();

    assert.equal(fetcher.markers[0], 500, 'первый запрос ушёл с сохранённым маркером');
    assert.equal(store.load(), 501);
  });

  it('ошибка обработчика не останавливает цикл', async () => {
    const fetcher = createFetcher([
      { updates: [message(1, 'ядовитый')], marker: 1 },
      { updates: [message(2, 'обычный')], marker: 2 },
    ]);
    const errors: unknown[] = [];

    const supervisor = new UpdateSupervisor({
      fetchUpdates: fetcher.fetch,
      handleUpdate: async (update) => {
        const text = (update['message'] as { body: { text: string } }).body.text;
        if (text === 'ядовитый') throw new Error('падение обработчика');
      },
      onHandlerError: (error) => void errors.push(error),
    });

    void supervisor.start();
    await waitFor(() => supervisor.stats.processed === 1 && supervisor.stats.failed === 1);
    await supervisor.stop();

    assert.equal(errors.length, 1);
    assert.equal(supervisor.stats.marker, 2, 'ядовитый апдейт не заблокировал продвижение');
  });

  it('переживает ошибку получения апдейтов и повторяет попытку', async () => {
    let attempt = 0;
    const delays: number[] = [];

    const supervisor = new UpdateSupervisor({
      fetchUpdates: async ({ signal }) => {
        attempt += 1;
        if (attempt <= 2) throw new TypeError('fetch failed');

        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { updates: [] };
      },
      handleUpdate: async () => undefined,
      backoff: { baseDelayMs: 1, jitter: false },
      onFetchError: (_error, _attempt, delayMs) => void delays.push(delayMs),
    });

    void supervisor.start();
    await waitFor(() => attempt >= 3);
    await supervisor.stop();

    assert.deepEqual(delays, [1, 2], 'задержка растёт экспоненциально');
    assert.equal(supervisor.stats.fetchErrors, 2);
  });

  it('останавливается мягко: текущий обработчик доводится до конца', async () => {
    let finished = false;
    const fetcher = createFetcher([{ updates: [message(1, 'долгая заявка')], marker: 7 }]);

    const supervisor = new UpdateSupervisor({
      fetchUpdates: fetcher.fetch,
      handleUpdate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        finished = true;
      },
      markerStore: new MemoryMarkerStore(),
    });

    const running = supervisor.start();
    await waitFor(() => fetcher.calls >= 1);
    await supervisor.stop();
    await running;

    assert.equal(finished, true, 'обработчик не прерван на середине');
    assert.equal(supervisor.stats.processed, 1);
    assert.equal(supervisor.isRunning, false);
  });

  it('не теряет апдейты, если маркер не успел сохраниться', async () => {
    const store = new MemoryMarkerStore();
    const seen: string[] = [];

    const crashing = new UpdateSupervisor({
      fetchUpdates: createFetcher([{ updates: [message(1, 'заявка')], marker: 10 }]).fetch,
      handleUpdate: async () => {
        seen.push('первый запуск');
        throw new Error('процесс упал');
      },
      markerStore: store,
    });

    void crashing.start();
    await waitFor(() => seen.length === 1);
    await crashing.stop();

    const restarted = new UpdateSupervisor({
      fetchUpdates: createFetcher([{ updates: [message(1, 'заявка')], marker: 10 }]).fetch,
      handleUpdate: async () => void seen.push('после рестарта'),
      markerStore: store,
    });

    void restarted.start();
    await waitFor(() => seen.length === 2);
    await restarted.stop();

    assert.deepEqual(seen, ['первый запуск', 'после рестарта']);
  });

  it('неудачная запись позиции приём апдейтов не останавливает', async () => {
    const seen: string[] = [];
    const failures: unknown[] = [];

    const broken: MarkerStore = {
      load: async () => undefined,
      save: async () => {
        throw new Error('нет места на диске');
      },
    };

    const supervisor = new UpdateSupervisor({
      fetchUpdates: createFetcher([
        { updates: [message(1, 'первая')], marker: 10 },
        { updates: [message(1, 'вторая')], marker: 20 },
      ]).fetch,
      handleUpdate: async (update) => {
        seen.push((update['message'] as { body?: { text?: string } }).body?.text ?? '');
      },
      markerStore: broken,
      onMarkerError: (error) => failures.push(error),
    });

    void supervisor.start();
    await waitFor(() => seen.length === 2, 'вторая пачка не обработана');
    await supervisor.stop();

    assert.deepEqual(seen, ['первая', 'вторая']);
    assert.equal(supervisor.stats.markerErrors, 2, 'о каждой неудаче сообщено');
    assert.equal(failures.length, 2);
  });

  it('нечитаемая позиция не мешает запуску', async () => {
    const seen: string[] = [];
    const failures: unknown[] = [];

    const broken: MarkerStore = {
      load: async () => {
        throw new Error('файл повреждён');
      },
      save: async () => undefined,
    };

    const supervisor = new UpdateSupervisor({
      fetchUpdates: createFetcher([{ updates: [message(1, 'заявка')], marker: 10 }]).fetch,
      handleUpdate: async () => void seen.push('обработано'),
      markerStore: broken,
      onMarkerError: (error) => failures.push(error),
    });

    void supervisor.start();
    await waitFor(() => seen.length === 1, 'апдейт не обработан');
    await supervisor.stop();

    assert.equal(failures.length, 1);
    assert.equal(supervisor.stats.processed, 1);
  });
});
