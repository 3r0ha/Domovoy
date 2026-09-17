import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemoryKeyValueClient, fromIoredis, fromNodeRedis } from '../dist/index.js';

interface RecordedCall {
  method: string;
  args: unknown[];
}

/** Двойник ioredis: флаги передаются позиционно. */
const createIoredis = (responses: Record<string, unknown> = {}) => {
  const calls: RecordedCall[] = [];

  return {
    calls,
    client: {
      get: (key: string) => {
        calls.push({ method: 'get', args: [key] });
        return Promise.resolve(('get' in responses ? responses['get'] : null) as string | null);
      },
      set: (key: string, value: string, ...args: unknown[]) => {
        calls.push({ method: 'set', args: [key, value, ...args] });
        return Promise.resolve('set' in responses ? responses['set'] : 'OK');
      },
      del: (key: string) => {
        calls.push({ method: 'del', args: [key] });
        return Promise.resolve(1);
      },
      eval: (script: string, numKeys: number, ...args: string[]) => {
        calls.push({ method: 'eval', args: [script, numKeys, ...args] });
        return Promise.resolve('eval' in responses ? responses['eval'] : 1);
      },
    },
  };
};

/** Двойник node-redis: флаги передаются объектом. */
const createNodeRedis = (responses: Record<string, unknown> = {}) => {
  const calls: RecordedCall[] = [];

  return {
    calls,
    client: {
      get: (key: string) => {
        calls.push({ method: 'get', args: [key] });
        return Promise.resolve(('get' in responses ? responses['get'] : null) as string | null);
      },
      set: (key: string, value: string, options?: { PX?: number; NX?: boolean }) => {
        calls.push({ method: 'set', args: [key, value, options] });
        return Promise.resolve(('set' in responses ? responses['set'] : 'OK') as string | null);
      },
      del: (key: string) => {
        calls.push({ method: 'del', args: [key] });
        return Promise.resolve(1);
      },
      eval: (script: string, options: { keys: string[]; arguments: string[] }) => {
        calls.push({ method: 'eval', args: [script, options] });
        return Promise.resolve('eval' in responses ? responses['eval'] : 1);
      },
    },
  };
};

describe('адаптер ioredis', () => {
  it('срок жизни передаётся позиционным флагом PX', async () => {
    const { client, calls } = createIoredis();

    await fromIoredis(client).set('key', 'value', 5000);

    assert.deepEqual(calls[0], { method: 'set', args: ['key', 'value', 'PX', 5000] });
  });

  it('без срока жизни флаги не передаются', async () => {
    const { client, calls } = createIoredis();

    await fromIoredis(client).set('key', 'value');

    assert.deepEqual(calls[0], { method: 'set', args: ['key', 'value'] });
  });

  it('захват ключа идёт с NX и подтверждается ответом OK', async () => {
    const { client, calls } = createIoredis({ set: 'OK' });

    const acquired = await fromIoredis(client).setIfAbsent('lock', 'token', 3000);

    assert.equal(acquired, true);
    assert.deepEqual(calls[0]?.args, ['lock', 'token', 'PX', 3000, 'NX']);
  });

  it('занятый ключ не захватывается', async () => {
    const { client } = createIoredis({ set: null });

    assert.equal(await fromIoredis(client).setIfAbsent('lock', 'token', 3000), false);
  });

  it('снятие блокировки идёт скриптом с ключом и токеном', async () => {
    const { client, calls } = createIoredis({ eval: 1 });

    const removed = await fromIoredis(client).deleteIfValue('lock', 'token');

    assert.equal(removed, true);
    assert.equal(calls[0]?.method, 'eval');
    assert.equal(calls[0]?.args[1], 1, 'скрипту передан один ключ');
    assert.deepEqual(calls[0]?.args.slice(2), ['lock', 'token']);
  });

  it('чужая блокировка не снимается', async () => {
    const { client } = createIoredis({ eval: 0 });

    assert.equal(await fromIoredis(client).deleteIfValue('lock', 'token'), false);
  });

  it('чтение и удаление проходят напрямую', async () => {
    const { client, calls } = createIoredis({ get: 'value' });
    const adapter = fromIoredis(client);

    assert.equal(await adapter.get('key'), 'value');
    await adapter.delete('key');

    assert.deepEqual(
      calls.map((call) => call.method),
      ['get', 'del'],
    );
  });
});

describe('адаптер node-redis', () => {
  it('срок жизни передаётся объектом параметров', async () => {
    const { client, calls } = createNodeRedis();

    await fromNodeRedis(client).set('key', 'value', 5000);

    assert.deepEqual(calls[0], { method: 'set', args: ['key', 'value', { PX: 5000 }] });
  });

  it('без срока жизни параметры не передаются', async () => {
    const { client, calls } = createNodeRedis();

    await fromNodeRedis(client).set('key', 'value');

    assert.deepEqual(calls[0], { method: 'set', args: ['key', 'value', undefined] });
  });

  it('захват ключа идёт с NX', async () => {
    const { client, calls } = createNodeRedis({ set: 'OK' });

    assert.equal(await fromNodeRedis(client).setIfAbsent('lock', 'token', 3000), true);
    assert.deepEqual(calls[0]?.args[2], { PX: 3000, NX: true });
  });

  it('занятый ключ не захватывается', async () => {
    const { client } = createNodeRedis({ set: null });

    assert.equal(await fromNodeRedis(client).setIfAbsent('lock', 'token', 3000), false);
  });

  it('снятие блокировки идёт скриптом с ключами и аргументами', async () => {
    const { client, calls } = createNodeRedis({ eval: 1 });

    assert.equal(await fromNodeRedis(client).deleteIfValue('lock', 'token'), true);
    assert.deepEqual(calls[0]?.args[1], { keys: ['lock'], arguments: ['token'] });
  });

  it('чужая блокировка не снимается', async () => {
    const { client } = createNodeRedis({ eval: 0 });

    assert.equal(await fromNodeRedis(client).deleteIfValue('lock', 'token'), false);
  });
});

describe('хранилище в памяти', () => {
  it('считает только живые записи', async () => {
    let now = 1_000_000;
    const client = new MemoryKeyValueClient(() => now);

    await client.set('a', '1', 1000);
    await client.set('b', '2', 5000);
    assert.equal(client.size, 2);

    now += 2000;
    assert.equal(client.size, 1, 'просроченная запись не учитывается');
  });

  it('чистка убирает просроченные записи', async () => {
    let now = 1_000_000;
    const client = new MemoryKeyValueClient(() => now);

    await client.set('a', '1', 1000);
    await client.set('b', '2', 1000);
    now += 2000;

    assert.equal(client.sweep(), 2);
    assert.equal(client.size, 0);
  });

  it('запись без срока жизни не истекает', async () => {
    let now = 1_000_000;
    const client = new MemoryKeyValueClient(() => now);

    await client.set('вечная', 'значение');
    now += 10 ** 9;

    assert.equal(await client.get('вечная'), 'значение');
  });
});
