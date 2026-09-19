import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createSessionAuth, type SessionAuth, type SessionTokenStore } from '@maxkit/server';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';

import type {
  DeviceHub,
  CapitalRepairDirectory,
  HandoffGateway,
  MeetingRegistry,
  MeterVision,
  Notifier,
  PaymentGateway,
  Reasoner,
  Repository,
  StickerRenderer,
  Transcriber,
} from '@domovoy/app';
import { appendVary, applyCompression, type CompressOptions } from './compress.js';
import { applyMetrics, type MetricsOptions } from './metrics.js';
import { applyOpenApi, type OpenApiOptions } from './openapi.js';
import { applyRateLimit, type RateLimiterOptions } from './rate-limit.js';
import { health, routes } from './routes.js';

/** Путь мини-приложения: корень занят лендингом. */
const MINI_APP_PREFIX = '/app';

export interface ServerOptions {
  /** Токен бота: им проверяется подпись параметров запуска мини-приложения. */
  botToken: string;
  repository: Repository;
  /** Дом по умолчанию, пока жилец не привязан к квартире. */
  defaultBuildingId: string;
  auth?: SessionAuth;
  /** Где живут сессии мини-приложения. */
  sessionStore?: SessionTokenStore;
  /** Куда уходят уведомления. Без него API работает молча. */
  notifier?: Notifier;
  /** Домофоны и камеры. Без них экраны про оборудование ничего не показывают. */
  hub?: DeviceHub;
  /** Общий секрет домофонии: им подписаны события от оборудования. */
  hubSecret?: string;
  /** Распознавание показаний с фотографии табло. Без него их вводят руками. */
  vision?: MeterVision;
  /** Расшифровка речи. Без неё обращение набирают с клавиатуры. */
  transcriber?: Transcriber;
  /** Разбор обращений моделью. Без него продукт работает на правилах. */
  reasoner?: Reasoner;
  /** Платёжный шлюз. Без него квитанция показывается, но оплатить нельзя. */
  payments?: PaymentGateway;
  /** Имя бота: из него собираются ссылки наклеек. */
  botName?: string;
  /** Рисование наклеек. Без него коды объектов только перечисляются. */
  stickers?: StickerRenderer;
  /** Канал передачи обращений смежным организациям. Без него передача идёт вручную. */
  handoffs?: HandoffGateway;
  /** Система собраний собственников. Без неё собрание остаётся подготовкой. */
  meetings?: MeetingRegistry;
  /** Сведения о капитальном ремонте. Без них раздела нет. */
  capitalRepair?: CapitalRepairDirectory;
  now?: () => Date;
  createId?: () => string;
  logger?: boolean;
  /** Откуда мини-приложению разрешено обращаться к API. */
  allowedOrigins?: (string | RegExp)[];
  /** Пределы частоты запросов. */
  rateLimit?: RateLimiterOptions | false;
  /** Метрики для системы наблюдения на `/metrics`. */
  metrics?: MetricsOptions | false;
  /** Сжатие ответов API. */
  compress?: CompressOptions | false;
  /** Режим проверки: жюри примеряет роли прямо в продукте. */
  demo?: boolean;
  /** Описание API в формате OpenAPI на `/openapi.json`. */
  openApi?: OpenApiOptions | false;
  /**
   * Статика рядом с API: лендинг в корне, мини-приложение в `/app`.
   */
  web?: { landing?: string; miniapp?: string };
  /** Кому можно открывать мини-приложение в рамке: клиент MAX именно так и делает. */
  frameAncestors?: string[];
  /** Приём апдейтов платформы по вебхуку: в боевом режиме бот работает так. */
  updates?: UpdatesOptions;
  /**
   * Кому верить в `X-Forwarded-For`. По умолчанию адреса частных сетей: продукт
   * стоит за обратным прокси в той же сети, а снаружи адрес подставить нельзя.
   */
  trustProxy?: boolean | string | string[];
}

/** Приёмник апдейтов платформы: сверяет секрет и ставит апдейт в очередь. */
export interface UpdateReceiver {
  verifySecret(header: string | string[] | undefined): boolean;
  receive(rawBody: string, header: string | string[] | undefined): { status: number; body: string };
}

export interface UpdatesOptions {
  receiver: UpdateReceiver;
  /** Заголовок, в котором платформа присылает секрет. */
  header: string;
  /** Адрес, на который платформа шлёт апдейты. */
  path?: string;
}

const UPDATES_PATH = '/bot/updates';

/** Обратный прокси стоит рядом, в той же сети. */
const TRUSTED_PROXIES = 'loopback, linklocal, uniquelocal';

/**
 * Предел длины части адреса. Умолчание Fastify равно сотне, и часть запросов
 * не доходила до схем: код объекта с наклейки описан длиной в 512 символов, а
 * длинный адрес отвечал промахом маршрута. Предел длины задаёт схема маршрута.
 */
const MAX_PARAM_LENGTH = 1024;

/** Ответы этих разделов принадлежат одному человеку и в общий кеш не кладутся. */
const PRIVATE_PREFIXES = ['/api/', '/auth/'];

/**
 * Насколько долго держать файл в кеше. Имя собранного файла содержит отпечаток
 * и не меняется, такой лежит год. Страница на них ссылается и перечитывается всегда.
 */
const cacheHeaders = (reply: FastifyReply, path: string): void => {
  // Сжатая копия приходит сюда своим именем: index.html.br это всё ещё страница.
  const name = path.replace(/\.(br|gz)$/u, '');
  const rule = name.includes('/assets/')
    ? 'public, max-age=31536000, immutable'
    : name.endsWith('.html')
      ? 'no-cache'
      : 'public, max-age=3600';

  void reply.header('cache-control', rule);
};

export const buildServer = async (options: ServerOptions): Promise<FastifyInstance> => {
  // Пустой токен даёт рабочий ключ подписи, и параметры запуска подделывает кто угодно.
  if (options.botToken.trim().length === 0) {
    throw new Error('Не задан токен бота: подпись параметров запуска проверять нечем');
  }

  const fastify = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.trustProxy ?? TRUSTED_PROXIES,
    routerOptions: { maxParamLength: MAX_PARAM_LENGTH },
  });

  const auth =
    options.auth ??
    createSessionAuth({
      botToken: options.botToken,
      ...(options.sessionStore ? { store: options.sessionStore } : {}),
    });

  if (options.allowedOrigins && options.allowedOrigins.length > 0) {
    await fastify.register(cors, {
      origin: options.allowedOrigins,
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['content-type', 'authorization', 'x-max-init-data'],
      maxAge: 3600,
    });
  }

  // Разбор тот же, что у Fastify: подстановка `__proto__` отвергается, битое тело
  // отвечает 400. Своё здесь только то, что пустое тело считается отсутствующим.
  const parseJson = fastify.getDefaultJsonParser('error', 'error');

  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';

    if (text.length === 0) {
      done(null, undefined);
      return;
    }

    void parseJson(request, text, done);
  });

  /** Заголовки безопасности ответа. */
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');

    if (PRIVATE_PREFIXES.some((prefix) => request.url.startsWith(prefix))) {
      // Ответ зависит от того, чей токен пришёл, и общему кешу не принадлежит.
      if (!reply.getHeader('cache-control')) reply.header('cache-control', 'no-store');

      appendVary(reply, 'authorization');
    }

    if (options.frameAncestors?.length && request.url.startsWith(MINI_APP_PREFIX)) {
      reply.header('content-security-policy', `frame-ancestors ${options.frameAncestors.join(' ')}`);
      return;
    }

    reply.header('x-frame-options', 'DENY');
  });

  const updatesPath = options.updates?.path ?? UPDATES_PATH;

  if (options.rateLimit !== false) {
    applyRateLimit(fastify, {
      ...(options.rateLimit ?? {}),
      ...(options.updates ? { exempt: [updatesPath, ...(options.rateLimit?.exempt ?? [])] } : {}),
    });
  }

  if (options.metrics !== false) applyMetrics(fastify, options.metrics ?? {});

  if (options.compress !== false) applyCompression(fastify, options.compress ?? {});

  if (options.openApi !== false) applyOpenApi(fastify, options.openApi ?? {});

  if (options.updates) {
    const { receiver, header } = options.updates;

    /** Апдейты платформы: тот же сервер, что и API, поэтому сертификат и адрес одни. */
    fastify.post(
      updatesPath,
      {
        onRequest: async (request, reply) => {
          if (receiver.verifySecret(request.headers[header])) return;

          await reply.code(401).send({ error: 'unauthorized', message: 'Нужен секрет платформы' });
        },
      },
      async (request, reply) => {
        const result = receiver.receive(JSON.stringify(request.body ?? {}), request.headers[header]);

        return reply.code(result.status).type('text/plain; charset=utf-8').send(result.body);
      },
    );
  }

  await fastify.register(health, { storage: () => options.repository.listBuildings() });
  await fastify.register(routes, {
    repository: options.repository,
    auth,
    botToken: options.botToken,
    now: options.now ?? (() => new Date()),
    createId: options.createId ?? randomUUID,
    defaultBuildingId: options.defaultBuildingId,
    ...(options.notifier ? { notifier: options.notifier } : {}),
    ...(options.hub ? { hub: options.hub } : {}),
    ...(options.hubSecret ? { hubSecret: options.hubSecret } : {}),
    ...(options.vision ? { vision: options.vision } : {}),
    ...(options.transcriber ? { transcriber: options.transcriber } : {}),
    ...(options.reasoner ? { reasoner: options.reasoner } : {}),
    ...(options.payments ? { payments: options.payments } : {}),
    ...(options.botName ? { botName: options.botName } : {}),
    ...(options.stickers ? { stickers: options.stickers } : {}),
    ...(options.handoffs ? { handoffs: options.handoffs } : {}),
    ...(options.meetings ? { meetings: options.meetings } : {}),
    ...(options.capitalRepair ? { capitalRepair: options.capitalRepair } : {}),
    ...(options.demo ? { demo: true } : {}),
  });

  if (options.web?.miniapp) {
    fastify.get(MINI_APP_PREFIX, async (_request, reply) => reply.redirect(`${MINI_APP_PREFIX}/`, 308));

    await fastify.register(fastifyStatic, {
      root: options.web.miniapp,
      prefix: `${MINI_APP_PREFIX}/`,
      index: ['index.html'],
      redirect: true,
      decorateReply: false,
      cacheControl: false,
      // Сжатые копии лежат рядом: сервер отдаёт готовый файл, а не жмёт в запросе.
      preCompressed: true,
      setHeaders: cacheHeaders,
    });
  }

  if (options.web?.landing) {
    const landing = options.web.landing;

    await fastify.register(fastifyStatic, {
      root: landing,
      prefix: '/',
      index: ['index.html'],
      redirect: true,
      decorateReply: false,
      cacheControl: false,
      // Сжатые копии лежат рядом: сервер отдаёт готовый файл, а не жмёт в запросе.
      preCompressed: true,
      setHeaders: cacheHeaders,
    });
  }

  const landing = options.web?.landing;

  /**
   * Промах по адресу. В API это отказ в JSON тем же кодом, что и остальные,
   * а промах по адресу сайта показывается страницей.
   */
  fastify.setNotFoundHandler(async (request, reply) => {
    const wantsPage =
      landing !== undefined &&
      request.method === 'GET' &&
      !request.url.startsWith('/api/') &&
      !request.url.startsWith('/auth/') &&
      (request.headers.accept ?? '').includes('text/html');

    const page = wantsPage ? await readFile(join(landing, '404.html'), 'utf8').catch(() => null) : null;

    if (page === null) return reply.code(404).send({ error: 'not_found', message: 'Не найдено' });

    return reply.code(404).type('text/html; charset=utf-8').send(page);
  });

  return fastify;
};
