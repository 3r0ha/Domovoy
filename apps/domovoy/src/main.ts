import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_BOT_NAME,
  InMemoryRepository,
  createSweeper,
  makeManager,
  createMockCapitalRepair,
  createMockHandoffs,
  createMockMeetings,
  createMockHub,
  createMockPayments,
  type Lock,
  type MeterVisionDeps,
  type Repository,
  type StickerRenderer,
} from '@domovoy/app';
import { buildServer } from '@domovoy/api';
import { BOT_COMMANDS, DEMO_COMMAND, createDomovoyBot } from '@domovoy/bot';
import { canRasterize, renderSticker, renderStickerPng, sheetFor } from '@domovoy/stickers';
import { PostgresRepository, applyMigrations, fromPool } from '@domovoy/storage';
import { BOT_API_SECRET_HEADER, FileMarkerStore, WebhookReceiver } from '@maxkit/runtime';
import { KeyValueSessionTokenStore, type SessionTokenStore } from '@maxkit/server';
import {
  DistributedLock,
  KeyValueSessionStore,
  distributedSession,
  fromNodeRedis,
  type KeyValueClient,
} from '@maxkit/sessions';
import pg from 'pg';
import { createClient } from 'redis';

import { createApartmentCode } from './codes.js';
import { demoDevices, demoDoorHistory, demoSensorContact, seedDemo } from './demo.js';
import { meterVisionFromEnv } from './meter-vision.js';
import { fileSweepStore, sharedSweepStore } from './sweep-store.js';
import { gigaChatFromEnv } from './gigachat.js';
import { gigaChatFilesFromEnv } from './gigachat-files.js';
import { reasonerFromEnv } from './reasoner.js';
import { transcriberFromEnv } from './transcriber.js';

/** Точка сборки продукта. */
const env = (name: string, fallback?: string): string => {
  // Пустая переменная считается незаданной.
  const value = process.env[name] || fallback;
  if (value === undefined) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
};

/**
 * Bot API MAX отдаёт сертификат «Russian Trusted Sub CA». Корня этой цепочки
 * в наборе Node.js нет, поэтому без него не проходит ни один запрос к платформе,
 * а ошибка выглядит как обычный сбой сети.
 */
const warnAboutCertificate = (error: unknown): void => {
  const code = (error as { cause?: { code?: string } }).cause?.code;

  if (code !== 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' && code !== 'SELF_SIGNED_CERT_IN_CHAIN') return;

  console.error(
    'Сертификат платформы не проверился. Задайте корень: ' +
      'NODE_EXTRA_CA_CERTS=./certs/russian-trusted-root-ca.pem (в образе он уже задан)',
  );
};

const REDIS_ATTEMPTS = 3;
const REDIS_CONNECT_TIMEOUT_MS = 3000;
const DATABASE_ATTEMPTS = 5;
const DATABASE_RETRY_MS = 2000;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const createRepository = async (): Promise<{ repository: Repository; close: () => Promise<void> }> => {
  const url = process.env['DATABASE_URL'];

  if (!url) {
    console.warn('DATABASE_URL не задан, данные хранятся в памяти и исчезнут при остановке');
    return { repository: new InMemoryRepository(), close: async () => undefined };
  }

  const pool = new pg.Pool({ connectionString: url });

  pool.on('error', (error) => console.error('Соединение с базой оборвалось', error));

  for (let attempt = 1; ; attempt++) {
    try {
      const applied = await applyMigrations(fromPool(pool));

      if (applied.length > 0) console.log(`Применены миграции: ${applied.join(', ')}`);
      break;
    } catch (error) {
      if (attempt === DATABASE_ATTEMPTS) {
        await pool.end().catch(() => undefined);
        throw error;
      }

      console.warn(`База не отвечает, попытка ${attempt} из ${DATABASE_ATTEMPTS}`, error);
      await wait(DATABASE_RETRY_MS);
    }
  }

  return { repository: new PostgresRepository(fromPool(pool)), close: () => pool.end() };
};

/** Состояние диалога вне процесса. */
const createSessions = async (): Promise<{
  sessionMiddleware?: (context: never, next: () => Promise<void>) => Promise<void>;
  sessionStore?: SessionTokenStore;
  /** Взаимное исключение между репликами: нужно склейке обращений. */
  lock?: Lock;
  /** Общее хранилище отметок обхода. */
  sweepKv?: KeyValueClient;
  closeSessions: () => Promise<void>;
}> => {
  const url = process.env['REDIS_URL'];

  if (!url) return { closeSessions: async () => undefined };

  const client = createClient({
    url,
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (attempt) => (attempt >= REDIS_ATTEMPTS ? false : Math.min((attempt + 1) * 200, 2000)),
    },
  });

  client.on('error', (error) => console.error('Redis недоступен', error));

  try {
    await client.connect();
  } catch (error) {
    console.error('Redis не отвечает: диалоги и сессии живут в памяти процесса', error);
    client.disconnect().catch(() => undefined);

    return { closeSessions: async () => undefined };
  }

  const kv = fromNodeRedis(client as never);
  const lock = new DistributedLock(kv);

  return {
    sessionMiddleware: distributedSession({
      store: new KeyValueSessionStore<object>(kv),
      lock,
    }),
    lock: (key, run) => lock.withLock(key, run),
    sweepKv: kv,
    sessionStore: new KeyValueSessionTokenStore(kv),
    closeSessions: () => client.quit().then(() => undefined),
  };
};

/** Каталог статики: если его нет, сервер просто не раздаёт эту часть. */
const folder = (path: string): string | undefined => {
  const full = resolve(process.cwd(), path);

  return existsSync(full) ? full : undefined;
};

const main = async (): Promise<void> => {
  const botToken = env('BOT_TOKEN');
  const port = Number(env('PORT', '3000'));
  const defaultBuildingId = env('DEFAULT_BUILDING_ID', 'dom15');

  const { repository, close } = await createRepository();
  const { sessionMiddleware, sessionStore, lock, sweepKv, closeSessions } = await createSessions();

  const now = (): Date => new Date();

  // Заглушки отвечают «оплачено» и открывают двери, поэтому включаются явно.
  const hub =
    process.env['HUB'] === 'mock'
      ? createMockHub({
          devices: demoDevices,
          now,
          history: demoDoorHistory(now()),
          lastSeen: demoSensorContact(now()),
        })
      : undefined;

  const payments = process.env['PAYMENTS'] === 'mock' ? createMockPayments({ now }) : undefined;

  // Канал передачи обращений смежным организациям. Настоящего обмена за модельным
  // каналом нет: он подтверждает приём и выдаёт номер, чтобы сценарий проходился целиком.
  const handoffs =
    process.env['HANDOFF'] === 'mock'
      ? createMockHandoffs({ channel: process.env['HANDOFF_CHANNEL']?.trim() || 'mock' })
      : undefined;

  // Сведения о капитальном ремонте: их ведёт региональная программа.
  const capitalRepair =
    process.env['CAPITAL_REPAIR'] === 'mock'
      ? createMockCapitalRepair({ title: process.env['CAPITAL_REPAIR_TITLE']?.trim() || undefined })
      : undefined;

  // Система собраний собственников: заочное голосование имеет силу только в ней.
  const meetings =
    process.env['MEETINGS'] === 'mock'
      ? createMockMeetings({ title: process.env['MEETINGS_TITLE']?.trim() || 'ГИС ЖКХ' })
      : undefined;

  if (!hub) console.warn('HUB не задан, домофония и датчики не подключены');
  if (!payments) console.warn('PAYMENTS не задан, оплата в приложении недоступна');
  if (!handoffs) console.warn('HANDOFF не задан, передача обращений записывается как ручная');
  if (!meetings) console.warn('MEETINGS не задан, собрание остаётся подготовкой без передачи в систему');

  // Снимки табло и голосовые разбирает тот же GigaChat, что и текст: отдельные
  // службы нужны, только если их задали отдельно, и тогда они идут первыми.
  const files = gigaChatFilesFromEnv(process.env, (error) =>
    console.error('GigaChat не разобрал файл', error),
  );

  const vision =
    meterVisionFromEnv(process.env, (error) =>
      console.error('Не удалось распознать показание с фотографии', error),
    ) ?? files?.vision;

  // Сначала GigaChat: у него бесплатный режим и российская инфраструктура.
  // Дальше любая служба, совместимая с форматом OpenAI.
  const reasoner =
    gigaChatFromEnv(process.env, (error) => console.error('GigaChat не ответил', error)) ??
    reasonerFromEnv(process.env, (error) => console.error('Не удалось разобрать обращение', error));

  if (!reasoner) console.warn('Модель не задана, категорию подскажут ключевые слова');

  const botName = process.env['BOT_NAME']?.trim() || DEFAULT_BOT_NAME;

  /**
   * Отрисовка наклейки в растр нужна, чтобы она пришла картинкой прямо в ленту чата.
   * Без неё продукт работает: наклейка уходит разметкой, которую печатают.
   */
  const raster = await canRasterize();

  if (!raster) console.warn('Наклейки уйдут разметкой: отрисовка в PNG недоступна');

  const stickers: StickerRenderer = {
    svg: renderSticker,
    sheet: sheetFor,
    ...(raster ? { png: async (plan, look) => (await renderStickerPng(plan, look)).toString('base64') } : {}),
  };

  const deps: MeterVisionDeps = {
    repository,
    now,
    createId: randomUUID,
    createCode: createApartmentCode,
    defaultBuildingId,
    botName,
    stickers,
    ...(hub ? { hub } : {}),
    ...(payments ? { payments } : {}),
    ...(handoffs ? { handoffs } : {}),
    ...(meetings ? { meetings } : {}),
    ...(capitalRepair ? { capitalRepair } : {}),
    ...(vision ? { vision } : {}),
    ...(reasoner ? { reasoner } : {}),
    ...(lock ? { lock } : {}),
  };

  // Без базы данные живут в памяти: продукт наполняется набором для показа сам,
  // иначе запуск одной командой открывает пустой дом и смотреть в нём нечего.
  if (!process.env['DATABASE_URL']) {
    const data = await seedDemo(deps, { withRequests: true });

    console.log(`Набор для показа заведён: дом ${data.address}, квартир ${data.apartments.length}`);
  }

  const owner = Number(process.env['OWNER_MAX_ID'] ?? '');

  if (Number.isFinite(owner) && owner > 0) {
    const manager = await makeManager(deps, owner, process.env['OWNER_NAME']);

    console.log(`Управляющий: ${manager.displayName} (MAX ${owner})`);
  }

  const transcriber =
    transcriberFromEnv(process.env, (error) =>
      console.error('Не удалось расшифровать голосовое сообщение', error),
    ) ?? files?.transcriber;

  if (!transcriber) {
    console.warn('Ни SPEECH_URL, ни GIGACHAT_AUTH_KEY не заданы, голосовые заявки придут без расшифровки');
  }

  if (!vision) console.warn('Показание с фотографии табло разобрать нечем, его вводят цифрами');

  // Проверка жюри идёт под одной учётной записью MAX: роль примеряется прямо в продукте.
  const demo = process.env['DEMO_ROLES'] === '1';

  if (demo) console.warn('DEMO_ROLES=1: в приложении и в боте доступно переключение роли');

  const bot = createDomovoyBot({
    token: botToken,
    deps,
    ...(demo ? { demo: true } : {}),
    ...(transcriber ? { transcriber } : {}),
    ...(vision ? { vision } : {}),
    ...(process.env['MAX_API_URL'] ? { baseUrl: process.env['MAX_API_URL'] } : {}),
    ...(process.env['MINI_APP_URL'] ? { miniAppUrl: process.env['MINI_APP_URL'] } : {}),
    // Адрес сайта: по нему бот даёт ссылки на политику и соглашение.
    ...(process.env['SITE_URL'] ? { siteUrl: process.env['SITE_URL'] } : {}),
    markerStore: new FileMarkerStore(env('MARKER_FILE', './state/marker')),
    ...(sessionMiddleware ? { sessionMiddleware } : {}),
    onNotifyError: (error) => console.error('Не удалось доставить уведомление', error),
    onHandlerError: (error) => console.error('Ошибка обработки апдейта', error),
  });

  /**
   * Лендинг и мини-приложение отдаёт тот же сервер. Каталоги подменяются,
   * если статику раздаёт кто-то другой.
   */
  const web = {
    landing: folder(process.env['LANDING_DIR'] ?? 'landing/dist'),
    miniapp: folder(process.env['MINIAPP_DIR'] ?? 'apps/miniapp/dist'),
  };

  /**
   * Откуда мини-приложению разрешено обращаться к API. При раздаче с того же
   * адреса список не нужен.
   */
  const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0 && !web.miniapp) {
    console.warn(
      'ALLOWED_ORIGINS не задан и мини-приложение не найдено рядом. Соберите его ' +
        '(npm run build) или укажите адрес, с которого оно открывается.',
    );
  }

  /**
   * Боевой режим платформы, вебхук: апдейты приходят на тот же сервер, что и API.
   * Без `WEBHOOK_URL` продукт забирает их опросом.
   */
  const webhookUrl = process.env['WEBHOOK_URL'];
  const webhookSecret = process.env['WEBHOOK_SECRET'];
  const webhookPath = process.env['WEBHOOK_PATH'] ?? '/bot/updates';

  if (webhookUrl && !webhookSecret) {
    throw new Error('WEBHOOK_URL задан без WEBHOOK_SECRET: без секрета апдейты примет кто угодно');
  }

  const receiver =
    webhookUrl && webhookSecret
      ? new WebhookReceiver({
          secret: webhookSecret,
          handleUpdate: bot.handleUpdate,
          onHandlerError: (error) => console.error('Ошибка обработки апдейта', error),
        })
      : undefined;

  const server = await buildServer({
    botToken,
    repository,
    defaultBuildingId,
    botName,
    stickers,
    logger: true,
    ...(demo ? { demo: true } : {}),
    notifier: bot.deps.notifier,
    ...(hub ? { hub } : {}),
    ...(payments ? { payments } : {}),
    ...(handoffs ? { handoffs } : {}),
    ...(meetings ? { meetings } : {}),
    ...(capitalRepair ? { capitalRepair } : {}),
    allowedOrigins,
    web,
    // Пустая переменная и незаданная означают одно и то же.
    frameAncestors: (process.env['FRAME_ANCESTORS'] || "'self' https://max.ru https://*.max.ru").split(' '),
    ...(process.env['HUB_SECRET'] ? { hubSecret: process.env['HUB_SECRET'] } : {}),
    ...(vision ? { vision } : {}),
    ...(transcriber ? { transcriber } : {}),
    ...(reasoner ? { reasoner } : {}),
    ...(sessionStore ? { sessionStore } : {}),
    ...(process.env['METRICS_TOKEN'] ? { metrics: { token: process.env['METRICS_TOKEN'] } } : {}),
    ...(receiver ? { updates: { receiver, header: BOT_API_SECRET_HEADER, path: webhookPath } } : {}),
  });

  try {
    bot.bot.botInfo = await bot.bot.api.getMyInfo();
  } catch (error) {
    console.error('MAX не сказал, кто мы: свои закреплённые сообщения бот не узнает', error);
    warnAboutCertificate(error);
  }

  try {
    await bot.bot.api.setMyCommands(demo ? [...BOT_COMMANDS, DEMO_COMMAND] : BOT_COMMANDS);
  } catch (error) {
    console.error('Меню команд не обновилось', error);
  }

  /** Регулярные проверки: закрыть непринятое молчанием и сообщить о нарушенных сроках. */
  const SWEEP_INTERVAL_MS = 5 * 60_000;

  const sweeper = createSweeper(
    { ...deps, notifier: bot.deps.notifier },
    {
      store: sweepKv ? sharedSweepStore(sweepKv) : fileSweepStore(env('SWEEP_FILE', './state/sweep.json')),
      lockKey: 'domovoy:sweep',
    },
  );

  const sweep = setInterval(() => {
    void sweeper
      .run()
      .then((report) => {
        for (const failure of report.failures) console.error(`Проверка «${failure.job}» не выполнена`, failure.error);

        const done = Object.entries(report)
          .filter(([name, count]) => name !== 'failures' && typeof count === 'number' && count > 0)
          .map(([name, count]) => `${name}: ${String(count)}`);

        if (done.length > 0) console.log(`Регулярная проверка: ${done.join(', ')}`);
      })
      .catch((error: unknown) => console.error('Регулярная проверка не выполнена', error));
  }, SWEEP_INTERVAL_MS);

  sweep.unref();

  await server.listen({ port, host: '0.0.0.0' });
  console.log(`API слушает порт ${port}, бот запущен`);

  let stopping: Promise<void> | undefined;

  const shutdown = async (): Promise<void> => {
    console.log('Останавливаемся…');

    clearInterval(sweep);
    await server.close();
    await (receiver ? receiver.drain() : bot.supervisor.stop());
    await close();
    await closeSessions();
  };

  const stop = (): Promise<void> => (stopping ??= shutdown().catch((error: unknown) => {
    console.error('Остановка прошла с ошибкой', error);
  }));

  if (receiver && webhookUrl) {
    await bot.bot.api.subscribe(webhookUrl, webhookSecret);
    console.log(`Апдейты приходят на ${webhookUrl}`);
  } else {
    bot.supervisor.start().catch((error: unknown) => {
      console.error('Приём апдейтов остановлен', error);
      process.exitCode = 1;
      void stop();
    });
  }

  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());

  process.on('unhandledRejection', (reason) => console.error('Необработанный отказ промиса', reason));

  process.on('uncaughtException', (error) => {
    console.error('Необработанное исключение', error);
    process.exitCode = 1;
    void stop();
  });
};

main().catch((error: unknown) => {
  console.error('Запуск не удался', error);
  process.exitCode = 1;
});
