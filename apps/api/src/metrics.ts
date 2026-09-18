import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { secretGuard } from './secret.js';

export interface MetricsOptions {
  /** Токен для чтения метрик. Без него страницы метрик нет. */
  token?: string;
  now?: () => number;
  /** Время старта процесса: по нему считается время работы. */
  startedAt?: number;
}

/** Один разрез счётчика: метод, маршрут и класс ответа. */
interface Key {
  method: string;
  route: string;
  status: number;
}

interface Counter {
  requests: number;
  /** Суммарное время ответа в секундах: со счётчиком даёт среднее. */
  seconds: number;
}

const label = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

const keyOf = (key: Key): string => `${key.method}|${key.route}|${key.status}`;

/** Метрики для системы наблюдения. */
export const applyMetrics = (fastify: FastifyInstance, options: MetricsOptions = {}): void => {
  const now = options.now ?? (() => Date.now());
  const startedAt = options.startedAt ?? now();
  const counters = new Map<string, Key & { requests: number }>();
  const durations = new Map<string, { method: string; route: string } & Counter>();

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith('/metrics')) return;

    const method = request.method;
    const route = request.routeOptions.url ?? 'unknown';
    const key: Key = { method, route, status: reply.statusCode };

    const id = keyOf(key);
    const counter = counters.get(id) ?? { ...key, requests: 0 };

    counter.requests += 1;
    counters.set(id, counter);

    const path = `${method}|${route}`;
    const duration = durations.get(path) ?? { method, route, requests: 0, seconds: 0 };

    duration.requests += 1;
    duration.seconds += reply.elapsedTime / 1000;
    durations.set(path, duration);
  });

  // Страница метрик перечисляет маршруты и состояние процесса: без токена её нет вовсе.
  if (!options.token) return;

  const authorized = secretGuard(`Bearer ${options.token}`);

  fastify.get('/metrics', async (request, reply) => {
    if (!authorized(request.headers.authorization)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Метрики закрыты токеном' });
    }

    const lines = [
      '# HELP domovoy_up Служба отвечает.',
      '# TYPE domovoy_up gauge',
      'domovoy_up 1',
      '# HELP domovoy_uptime_seconds Сколько секунд работает процесс.',
      '# TYPE domovoy_uptime_seconds gauge',
      `domovoy_uptime_seconds ${Math.round((now() - startedAt) / 1000)}`,
      '# HELP domovoy_heap_used_bytes Занятая память кучи.',
      '# TYPE domovoy_heap_used_bytes gauge',
      `domovoy_heap_used_bytes ${process.memoryUsage().heapUsed}`,
      '# HELP domovoy_http_requests_total Обработанные запросы.',
      '# TYPE domovoy_http_requests_total counter',
    ];

    for (const counter of counters.values()) {
      const marks = `method="${label(counter.method)}",route="${label(counter.route)}",status="${counter.status}"`;

      lines.push(`domovoy_http_requests_total{${marks}} ${counter.requests}`);
    }

    lines.push(
      '# HELP domovoy_http_request_duration_seconds_sum Суммарное время ответа.',
      '# TYPE domovoy_http_request_duration_seconds_sum counter',
    );

    for (const duration of durations.values()) {
      const marks = `method="${label(duration.method)}",route="${label(duration.route)}"`;

      lines.push(`domovoy_http_request_duration_seconds_sum{${marks}} ${duration.seconds.toFixed(6)}`);
    }

    lines.push(
      '# HELP domovoy_http_request_duration_seconds_count Сколько ответов вошло в сумму.',
      '# TYPE domovoy_http_request_duration_seconds_count counter',
    );

    for (const duration of durations.values()) {
      const marks = `method="${label(duration.method)}",route="${label(duration.route)}"`;

      lines.push(`domovoy_http_request_duration_seconds_count{${marks}} ${duration.requests}`);
    }

    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(`${lines.join('\n')}\n`);
  });
};
