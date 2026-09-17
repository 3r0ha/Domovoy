/** Ограничитель одновременно выполняемых задач. */
export class Semaphore {
  private available: number;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new RangeError('Semaphore: ёмкость должна быть не меньше единицы');
    this.available = capacity;
  }

  get free(): number {
    return this.available;
  }

  get pending(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return this.createRelease();
    }

    await new Promise<void>((resolve) => this.waiters.push(resolve));
    return this.createRelease();
  }

  private createRelease(): () => void {
    let released = false;

    return () => {
      if (released) return;
      released = true;

      const next = this.waiters.shift();
      if (next) {
        next();
        return;
      }

      this.available = Math.min(this.available + 1, this.capacity);
    };
  }
}

/** Не больше `concurrency` задач сразу и строгий порядок внутри ключа: для бота ключ, чат. */
export class OrderedScheduler {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly semaphore: Semaphore;
  private active = 0;

  constructor(concurrency: number) {
    this.semaphore = new Semaphore(concurrency);
  }

  /** Сколько задач сейчас выполняется или ждёт очереди. */
  get inFlight(): number {
    return this.active;
  }

  run(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    this.active += 1;

    const current = previous.then(async () => {
      const release = await this.semaphore.acquire();
      try {
        await task();
      } finally {
        release();
        this.active -= 1;
      }
    });

    const tail = current.catch(() => undefined);
    this.tails.set(key, tail);

    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });

    return current;
  }

  /** Дожидается завершения всех поставленных задач. */
  async drain(): Promise<void> {
    while (this.tails.size > 0) {
      await Promise.all([...this.tails.values()]);
    }
  }
}
