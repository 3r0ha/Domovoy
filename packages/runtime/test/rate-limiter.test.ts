import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RateLimiter,
  computeRetryDelay,
  defaultShouldRetry,
  parseRetryAfter,
  resolveRetryOptions,
  type HttpMethod,
} from '../dist/index.js';

/** Часы и ожидание под контролем теста: время двигается только тем, что просит лимитер. */
const createClock = () => {
  let now = 1_000_000;
  const waits: number[] = [];

  return {
    waits,
    now: () => now,
    sleep: async (ms: number) => {
      waits.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
};

describe('RateLimiter', () => {
  it('выдерживает равномерный темп', async () => {
    const clock = createClock();
    const limiter = new RateLimiter({ rps: 10, burst: 1, now: clock.now, sleep: clock.sleep });

    for (let index = 0; index < 4; index += 1) await limiter.acquire();

    assert.deepEqual(clock.waits, [100, 100, 100], 'первый запрос уходит сразу, дальше, раз в 100 мс');
  });

  it('разрешает залп после простоя, но ограничивает его окном burst', async () => {
    const clock = createClock();
    const limiter = new RateLimiter({ rps: 10, burst: 3, now: clock.now, sleep: clock.sleep });

    clock.advance(10_000);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    assert.deepEqual(clock.waits, [], 'три запроса ушли без ожидания');

    await limiter.acquire();
    assert.deepEqual(clock.waits, [100], 'четвёртый уже ждёт свой слот');
  });

  it('pause отодвигает очередь для всех запросов', async () => {
    const clock = createClock();
    const limiter = new RateLimiter({ rps: 100, now: clock.now, sleep: clock.sleep });

    limiter.pause(2000);
    await limiter.acquire();

    assert.deepEqual(clock.waits, [2000]);
  });

  it('показывает длину очереди', async () => {
    const clock = createClock();
    const limiter = new RateLimiter({ rps: 1, burst: 1, now: clock.now, sleep: clock.sleep });

    assert.equal(limiter.queuedSlots, 0);
    await limiter.acquire();
    assert.equal(limiter.queuedSlots, 1, 'следующий запрос уже ждёт секунду');
  });

  it('отменяется по сигналу', async () => {
    const limiter = new RateLimiter({ rps: 1, burst: 1 });
    const controller = new AbortController();

    await limiter.acquire();
    const pending = limiter.acquire(controller.signal);
    controller.abort(new Error('стоп'));

    await assert.rejects(pending, /стоп/);
  });

  it('не принимает нулевую скорость', () => {
    assert.throws(() => new RateLimiter({ rps: 0 }), RangeError);
  });
});

describe('политика повторов', () => {
  const decide = (method: HttpMethod, status?: number, error?: unknown): boolean =>
    defaultShouldRetry({ method, apiMethod: 'messages', attempt: 1, ...(status ? { status } : {}), error });

  it('429 повторяется для любого метода: запрос не был обработан', () => {
    assert.equal(decide('POST', 429), true);
    assert.equal(decide('GET', 429), true);
  });

  it('ошибки шлюза повторяются для любого метода', () => {
    for (const status of [502, 503, 504]) assert.equal(decide('POST', status), true, `status ${status}`);
  });

  it('500 повторяется только для идемпотентных методов', () => {
    assert.equal(decide('GET', 500), true);
    assert.equal(decide('DELETE', 500), true);
    assert.equal(decide('POST', 500), false, 'сообщение могло уйти, дубль хуже ошибки');
  });

  it('обрыв сети повторяется только для идемпотентных методов', () => {
    assert.equal(decide('GET', undefined, new TypeError('fetch failed')), true);
    assert.equal(decide('POST', undefined, new TypeError('fetch failed')), false);
  });

  it('ошибки запроса не повторяются', () => {
    assert.equal(decide('GET', 400), false);
    assert.equal(decide('GET', 404), false);
    assert.equal(decide('POST', 403), false);
  });
});

describe('расчёт задержки', () => {
  const options = resolveRetryOptions({ baseDelayMs: 100, maxDelayMs: 1000, jitter: false });

  it('растёт экспоненциально и упирается в потолок', () => {
    assert.equal(computeRetryDelay(1, options), 100);
    assert.equal(computeRetryDelay(2, options), 200);
    assert.equal(computeRetryDelay(3, options), 400);
    assert.equal(computeRetryDelay(9, options), 1000);
  });

  it('джиттер держится в половине интервала', () => {
    const jittered = resolveRetryOptions({ baseDelayMs: 100, jitter: true, random: () => 0 });
    assert.equal(computeRetryDelay(1, jittered), 50);

    const upper = resolveRetryOptions({ baseDelayMs: 100, jitter: true, random: () => 1 });
    assert.equal(computeRetryDelay(1, upper), 100);
  });

  it('Retry-After важнее собственного расчёта', () => {
    assert.equal(computeRetryDelay(1, options, 750), 750);
    assert.equal(computeRetryDelay(1, options, 60_000), 1000, 'но не выше потолка');
  });

  it('разбирает Retry-After в секундах и в виде даты', () => {
    const now = Date.parse('2026-09-03T10:00:00Z');

    assert.equal(parseRetryAfter('5', now), 5000);
    assert.equal(parseRetryAfter('Thu, 03 Sep 2026 10:00:30 GMT', now), 30_000);
    assert.equal(parseRetryAfter('чепуха', now), undefined);
    assert.equal(parseRetryAfter(null, now), undefined);
  });
});
