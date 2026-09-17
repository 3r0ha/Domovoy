import { sleep } from './sleep.js';

export interface RateLimiterOptions {
  /** Запросов в секунду. Платформа MAX документирует лимит 30 rps на `platform-api2.max.ru`. */
  rps?: number;
  /** Сколько запросов разрешено выпустить залпом после простоя. По умолчанию, как rps. */
  burst?: number;
  /** Часы. Подменяются в тестах. */
  now?: () => number;
  /** Ожидание. Подменяется в тестах. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Планировщик запросов под лимит платформы. */
export class RateLimiter {
  private readonly intervalMs: number;
  private readonly burstWindowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private nextSlotAt = 0;

  constructor(options: RateLimiterOptions = {}) {
    const rps = options.rps ?? 30;
    if (rps <= 0) throw new RangeError('RateLimiter: rps должен быть больше нуля');

    const burst = options.burst ?? rps;
    this.intervalMs = 1000 / rps;
    this.burstWindowMs = this.intervalMs * Math.max(burst - 1, 0);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? sleep;
  }

  /** Сколько запросов сейчас стоит в очереди (в единицах слотов). */
  get queuedSlots(): number {
    const ahead = this.nextSlotAt - this.now();
    return ahead <= 0 ? 0 : Math.ceil(ahead / this.intervalMs);
  }

  /** Ждёт своей очереди. Возвращает, сколько миллисекунд пришлось ждать. */
  async acquire(signal?: AbortSignal): Promise<number> {
    const now = this.now();

    const start = Math.max(this.nextSlotAt, now - this.burstWindowMs);
    this.nextSlotAt = start + this.intervalMs;

    const waitMs = start - now;
    if (waitMs <= 0) return 0;

    await this.sleep(waitMs, signal);
    return waitMs;
  }

  /** Отодвигает очередь: платформа попросила подождать (429 с `Retry-After`). */
  pause(ms: number): void {
    this.nextSlotAt = Math.max(this.nextSlotAt, this.now() + ms);
  }
}
