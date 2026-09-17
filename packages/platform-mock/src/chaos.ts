export type ChaosAction =
  | { kind: 'status'; status: number; body?: unknown; headers?: Record<string, string> }
  /** Ответ не приходит вовсе: проверка таймаутов на стороне клиента. */
  | { kind: 'hang' }
  /** Ответ приходит, но с задержкой. */
  | { kind: 'delay'; ms: number }
  /** Соединение обрывается без ответа. */
  | { kind: 'abort' };

interface ChaosRule {
  action: ChaosAction;
  remaining: number;
  /** Применять только к запросам, чей путь содержит эту подстроку. */
  path?: string;
}

export interface FaultOptions {
  /** Сколько запросов подряд получат этот ответ. */
  times?: number;
  /** Ограничение по пути, например `messages`. */
  path?: string;
  /** Значение заголовка `Retry-After` в секундах. */
  retryAfterSeconds?: number;
  body?: unknown;
}

/** Программируемые сбои платформы. */
export class Chaos {
  private readonly rules: ChaosRule[] = [];

  /** Сколько запрограммированных сбоев ещё не израсходовано. */
  get pending(): number {
    return this.rules.reduce((total, rule) => total + rule.remaining, 0);
  }

  /** Ответить кодом ошибки. */
  failNext(status: number, options: FaultOptions = {}): this {
    const headers: Record<string, string> = {};
    if (options.retryAfterSeconds !== undefined) headers['retry-after'] = String(options.retryAfterSeconds);

    return this.push(
      {
        kind: 'status',
        status,
        body: options.body ?? { code: 'chaos', message: `Запрограммированная ошибка ${status}` },
        headers,
      },
      options,
    );
  }

  /** Не отвечать: запрос повиснет до таймаута клиента. */
  hangNext(options: FaultOptions = {}): this {
    return this.push({ kind: 'hang' }, options);
  }

  /** Ответить с задержкой. */
  delayNext(ms: number, options: FaultOptions = {}): this {
    return this.push({ kind: 'delay', ms }, options);
  }

  /** Оборвать соединение: клиент получит сетевую ошибку. */
  abortNext(options: FaultOptions = {}): this {
    return this.push({ kind: 'abort' }, options);
  }

  /** Достаёт правило для очередного запроса. */
  take(path: string): ChaosAction | undefined {
    const index = this.rules.findIndex((rule) => rule.remaining > 0 && (!rule.path || path.includes(rule.path)));
    if (index === -1) return undefined;

    const rule = this.rules[index]!;
    rule.remaining -= 1;
    if (rule.remaining === 0) this.rules.splice(index, 1);

    return rule.action;
  }

  reset(): void {
    this.rules.length = 0;
  }

  private push(action: ChaosAction, options: FaultOptions): this {
    this.rules.push({
      action,
      remaining: options.times ?? 1,
      ...(options.path ? { path: options.path } : {}),
    });
    return this;
  }
}
