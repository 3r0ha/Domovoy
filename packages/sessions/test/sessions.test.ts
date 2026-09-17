import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DistributedLock,
  KeyValueSessionStore,
  LockTimeoutError,
  MemoryKeyValueClient,
  distributedSession,
  type SessionContextLike,
} from '../dist/index.js';

/** Управляемые часы: срок жизни ключей проверяется без ожидания. */
const createClock = () => {
  let now = 1_000_000;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    sleep: async (ms: number) => {
      now += ms;
    },
  };
};

describe('KeyValueSessionStore', () => {
  it('сохраняет и читает состояние', async () => {
    const store = new KeyValueSessionStore<{ step: string }>(new MemoryKeyValueClient());

    await store.set('7:42', { step: 'ждём адрес' });

    assert.deepEqual(await store.get('7:42'), { step: 'ждём адрес' });
  });

  it('возвращает undefined для незнакомого ключа', async () => {
    const store = new KeyValueSessionStore(new MemoryKeyValueClient());

    assert.equal(await store.get('нет такого'), undefined);
  });

  it('срок жизни отсчитывается заново при каждой записи', async () => {
    const clock = createClock();
    const client = new MemoryKeyValueClient(clock.now);
    const store = new KeyValueSessionStore<{ count: number }>(client, { ttlMs: 1000 });

    await store.set('key', { count: 1 });
    clock.advance(800);
    await store.set('key', { count: 2 });

    clock.advance(800);
    assert.deepEqual(await store.get('key'), { count: 2 }, 'активная сессия не истекла');

    clock.advance(1200);
    assert.equal(await store.get('key'), undefined, 'заброшенная сессия убрана');
  });

  it('повреждённое значение не роняет обработчик', async () => {
    const client = new MemoryKeyValueClient();
    await client.set('maxkit:session:key', 'не json');

    const corrupted: string[] = [];
    const store = new KeyValueSessionStore(client, { onCorruptedValue: (key) => void corrupted.push(key) });

    assert.equal(await store.get('key'), undefined);
    assert.deepEqual(corrupted, ['key']);
    assert.equal(await client.get('maxkit:session:key'), null, 'битое значение удалено');
  });

  it('удаляет состояние', async () => {
    const store = new KeyValueSessionStore<{ a: number }>(new MemoryKeyValueClient());

    await store.set('key', { a: 1 });
    await store.delete('key');

    assert.equal(await store.get('key'), undefined);
  });
});

describe('DistributedLock', () => {
  it('не отдаёт блокировку второму владельцу', async () => {
    const lock = new DistributedLock(new MemoryKeyValueClient());

    const first = await lock.tryAcquire('chat:1');
    const second = await lock.tryAcquire('chat:1');

    assert.notEqual(first, null);
    assert.equal(second, null);

    await first?.release();
    assert.notEqual(await lock.tryAcquire('chat:1'), null, 'после освобождения ключ снова доступен');
  });

  it('разные ключи не мешают друг другу', async () => {
    const lock = new DistributedLock(new MemoryKeyValueClient());

    assert.notEqual(await lock.tryAcquire('chat:1'), null);
    assert.notEqual(await lock.tryAcquire('chat:2'), null);
  });

  it('истекшая блокировка достаётся другому процессу', async () => {
    const clock = createClock();
    const lock = new DistributedLock(new MemoryKeyValueClient(clock.now), { now: clock.now, ttlMs: 1000 });

    await lock.tryAcquire('chat:1');
    clock.advance(1500);

    assert.notEqual(await lock.tryAcquire('chat:1'), null, 'упавший процесс не держит ключ вечно');
  });

  it('владелец не снимает чужую блокировку', async () => {
    const clock = createClock();
    const client = new MemoryKeyValueClient(clock.now);
    const lock = new DistributedLock(client, { now: clock.now, ttlMs: 1000 });

    const first = await lock.tryAcquire('chat:1');
    clock.advance(1500);
    const second = await lock.tryAcquire('chat:1');

    await first?.release();

    assert.equal(await client.get('maxkit:lock:chat:1'), second?.token, 'ключ остался у нового владельца');
  });

  it('продлить блокировку может только её владелец', async () => {
    const clock = createClock();
    const lock = new DistributedLock(new MemoryKeyValueClient(clock.now), { now: clock.now, ttlMs: 1000 });

    const handle = await lock.tryAcquire('chat:1');
    assert.equal(await handle?.extend(5000), true);

    clock.advance(3000);
    assert.equal(await lock.tryAcquire('chat:1'), null, 'продление подействовало');

    clock.advance(3000);
    const next = await lock.tryAcquire('chat:1');
    assert.notEqual(next, null);
    assert.equal(await handle?.extend(), false, 'прежний владелец больше не хозяин ключа');
  });

  it('продление не воскрешает чужую блокировку', async () => {
    const clock = createClock();
    const client = new MemoryKeyValueClient(clock.now);
    const lock = new DistributedLock(client, { now: clock.now, ttlMs: 1000 });

    const first = await lock.tryAcquire('chat:1');

    clock.advance(1500);
    const second = await lock.tryAcquire('chat:1');

    assert.equal(await first?.extend(5000), false);
    assert.equal(await client.get('maxkit:lock:chat:1'), second?.token, 'ключ остался у нового владельца');
  });

  it('ожидание завершается ошибкой, если ключ не освободили', async () => {
    const clock = createClock();
    const lock = new DistributedLock(new MemoryKeyValueClient(clock.now), {
      now: clock.now,
      sleep: clock.sleep,
      ttlMs: 60_000,
      waitMs: 200,
      retryDelayMs: 50,
    });

    await lock.tryAcquire('chat:1');

    await assert.rejects(lock.acquire('chat:1'), LockTimeoutError);
  });

  it('продлевает блокировку, пока задача выполняется', async () => {
    const client = new MemoryKeyValueClient();
    const lock = new DistributedLock(client, { ttlMs: 40 });
    const other = new DistributedLock(client, { ttlMs: 40 });
    const attempts: boolean[] = [];

    await lock.withLock(
      'chat:1',
      async () => {
        for (let step = 0; step < 5; step += 1) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          attempts.push((await other.tryAcquire('chat:1')) !== null);
        }
      },
      40,
    );

    assert.deepEqual(attempts, [false, false, false, false, false], 'ключ не достался никому другому');
  });

  it('без продления долгая задача теряет блокировку', async () => {
    const client = new MemoryKeyValueClient();
    const lock = new DistributedLock(client, { ttlMs: 30, autoExtend: false });
    const other = new DistributedLock(client, { ttlMs: 30 });
    let stolen = false;

    await lock.withLock(
      'chat:1',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        stolen = (await other.tryAcquire('chat:1')) !== null;
      },
      30,
    );

    assert.equal(stolen, true, 'поведение без продления зафиксировано намеренно');
  });

  it('withLock освобождает ключ даже при ошибке задачи', async () => {
    const client = new MemoryKeyValueClient();
    const lock = new DistributedLock(client);

    await assert.rejects(
      lock.withLock('chat:1', async () => {
        throw new Error('обработчик упал');
      }),
      /обработчик упал/,
    );

    assert.equal(await client.get('maxkit:lock:chat:1'), null);
  });
});

describe('distributedSession', () => {
  interface Ctx extends SessionContextLike {
    session?: { count: number };
  }

  const buildMiddleware = (client: MemoryKeyValueClient) =>
    distributedSession<{ count: number }, Ctx>({
      store: new KeyValueSessionStore<{ count: number }>(client),
      lock: new DistributedLock(client, { retryDelayMs: 1 }),
      defaultSession: () => ({ count: 0 }),
    });

  const context = (): Ctx => ({ chatId: 42, user: { user_id: 7 } });

  it('переносит состояние между апдейтами', async () => {
    const client = new MemoryKeyValueClient();
    const middleware = buildMiddleware(client);

    const first = context();
    await middleware(first, async () => {
      first.session!.count += 1;
    });

    const second = context();
    await middleware(second, async () => {
      second.session!.count += 1;
    });

    assert.equal(second.session?.count, 2);
  });

  it('не теряет изменения при одновременной обработке', async () => {
    const client = new MemoryKeyValueClient();
    const middleware = buildMiddleware(client);

    const slowHandler = async (ctx: Ctx): Promise<void> => {
      const value = ctx.session!.count;
      await new Promise((resolve) => setTimeout(resolve, 10));
      ctx.session!.count = value + 1;
    };

    const first = context();
    const second = context();

    await Promise.all([middleware(first, () => slowHandler(first)), middleware(second, () => slowHandler(second))]);

    const store = new KeyValueSessionStore<{ count: number }>(client);
    assert.deepEqual(await store.get('7:42'), { count: 2 }, 'ни одно изменение не затёрлось');
  });

  it('сохраняет состояние, даже если обработчик упал', async () => {
    const client = new MemoryKeyValueClient();
    const middleware = buildMiddleware(client);
    const ctx = context();

    await assert.rejects(
      middleware(ctx, async () => {
        ctx.session!.count = 5;
        throw new Error('падение на середине сценария');
      }),
      /падение на середине сценария/,
    );

    const store = new KeyValueSessionStore<{ count: number }>(client);
    assert.deepEqual(await store.get('7:42'), { count: 5 });
  });

  it('удаляет состояние, если обработчик обнулил сессию', async () => {
    const client = new MemoryKeyValueClient();
    const middleware = buildMiddleware(client);

    const ctx = context();
    await middleware(ctx, async () => {
      ctx.session!.count = 3;
    });

    const next = context();
    await middleware(next, async () => {
      next.session = undefined;
    });

    const store = new KeyValueSessionStore<object>(client);
    assert.equal(await store.get('7:42'), undefined);
  });

  it('без ключа сессии обработка продолжается', async () => {
    const client = new MemoryKeyValueClient();
    const middleware = buildMiddleware(client);
    const ctx: Ctx = {};
    let called = false;

    await middleware(ctx, async () => {
      called = true;
    });

    assert.equal(called, true);
    assert.equal(ctx.session, undefined);
  });

  it('запрещает опасное имя поля', () => {
    const client = new MemoryKeyValueClient();

    assert.throws(
      () =>
        distributedSession({
          store: new KeyValueSessionStore<object>(client),
          lock: new DistributedLock(client),
          property: '__proto__',
        }),
      TypeError,
    );
  });
});
