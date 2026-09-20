import {
  assertApartment,
  ensureResident,
  openByCode,
  raiseSensorAlarm,
  type MeterVisionDeps,
  type Transcriber,
} from '@domovoy/app';
import { maxSession, type SessionAuth } from '@maxkit/server';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { domainErrorHandler } from './errors.js';
import { billingRoutes } from './routes/billing.js';
import { broadcastRoutes } from './routes/broadcast.js';
import { buildingRoutes } from './routes/buildings.js';
import { deviceRoutes } from './routes/devices.js';
import { capitalRoutes } from './routes/capital.js';
import { complaintRoutes } from './routes/complaint.js';
import { handoverRoutes } from './routes/handover.js';
import { houseRoutes } from './routes/house.js';
import { LEGAL_DOCUMENTS, LEGAL_VERSION, formatLegal } from '@domovoy/domain';

import { meRoutes } from './routes/me.js';
import { meterRoutes } from './routes/meters.js';
import { requestRoutes } from './routes/requests.js';
import { staffRoutes } from './routes/staff.js';
import { stickerRoutes } from './routes/stickers.js';
import { supportRoutes } from './routes/support.js';
import { handoffRoutes } from './routes/handoffs.js';
import { visitRoutes } from './routes/visits.js';
import { voiceRoutes } from './routes/voice.js';
import { votingRoutes } from './routes/voting.js';
import { secretGuard } from './secret.js';
import {
  buildingIdSchema,
} from './serialize.js';

/**
 * Что открыто жильцу без квартиры: профиль, документы, привязка и режим
 * проверки. Остальные маршруты отвечают ему отказом `apartment_required`.
 */
const WITHOUT_APARTMENT = new Set([
  '/api/me',
  '/api/me/legal',
  '/api/me/apartment',
  '/api/me/apartments',
  '/api/me/apartment/use',
  '/api/me/data',
  '/api/me/notices',
  '/api/me/contact',
  '/api/me/logout',
  '/api/demo',
]);

export interface RoutesOptions extends MeterVisionDeps {
  auth: SessionAuth;
  /** Общий секрет домофонии. Без него маршрутов для оборудования нет. */
  hubSecret?: string;
  /** Токен бота: им подписан телефон, полученный через `requestContact`. */
  botToken?: string;
  /** Расшифровка речи. Без неё голосовой ручки нет. */
  transcriber?: Transcriber;
}

/** HTTP-адаптер продукта. */
export const routes: FastifyPluginAsync<RoutesOptions> = async (fastify, options) => {
  const { auth, ...deps } = options;

  fastify.setErrorHandler(domainErrorHandler(fastify));

  fastify.post(
    '/auth/session',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { token: { type: 'string' }, expiresAt: { type: 'number' }, displayName: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const header = request.headers['x-max-init-data'];
      const initData = Array.isArray(header) ? header[0] : header;

      const issued = await auth.issue(initData);
      const user = issued.session.data.user;

      const resident = await ensureResident(deps, {
        maxUserId: issued.session.userId,
        displayName: [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Жилец',
      });

      return reply.send({ token: issued.token, expiresAt: issued.expiresAt, displayName: resident.displayName });
    },
  );

  /**
   * Документы продукта: политика обработки персональных данных открывается
   * без входа, этого требует ч. 2 ст. 18.1 152-ФЗ.
   */
  fastify.get('/api/legal', { config: { open: true } }, async () => ({
    version: LEGAL_VERSION,
    documents: LEGAL_DOCUMENTS.map((document) => ({
      slug: document.slug,
      title: document.title,
      short: document.short,
      about: document.about,
      text: formatLegal(document),
    })),
  }));

  /** События от домофонии. */
  if (options.hubSecret) {
    const matches = secretGuard(options.hubSecret);
    const authorized = (request: FastifyRequest): boolean => matches(request.headers['x-hub-secret']);

    /** Секрет сверяется до разбора тела: без него запрос дальше не идёт. */
    const guard = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (authorized(request)) return;

      await reply.code(401).send({ error: 'unauthorized', message: 'Нужен секрет' });
    };

    fastify.post<{ Body: { buildingId: string; deviceId: string } }>(
      '/api/hub/alarm',
      {
        onRequest: guard,
        config: { open: true },
        schema: {
          body: {
            type: 'object',
            required: ['buildingId', 'deviceId'],
            additionalProperties: false,
            properties: {
              buildingId: buildingIdSchema,
              deviceId: { type: 'string', minLength: 1, maxLength: 128 },
            },
          },
        },
      },
      async (request, reply) => {
        const result = await raiseSensorAlarm(deps, request.body.buildingId, request.body.deviceId);

        return reply.code(202).send({
          requestId: result.kind === 'created' ? result.request.id : result.kind === 'joined' ? result.request.id : null,
          joined: result.kind === 'joined',
        });
      },
    );

    fastify.post<{ Body: { code: string } }>(
      '/api/hub/guest-entry',
      {
        onRequest: guard,
        config: { open: true },
        schema: {
          body: {
            type: 'object',
            required: ['code'],
            additionalProperties: false,
            properties: { code: { type: 'string', minLength: 1, maxLength: 32 } },
          },
        },
      },
      async (request, reply) => {
        await openByCode(deps, request.body.code);

        return reply.code(204).send();
      },
    );
  }

  // Всё, что требует сессии, живёт в одной области: проверка токена ставится один раз.
  await fastify.register(async (scope) => {
    await scope.register(maxSession, { auth });

    /** Жилец без квартиры дальше профиля и привязки не проходит. */
    scope.addHook('preValidation', async (request) => {
      if (WITHOUT_APARTMENT.has(request.routeOptions.url ?? '')) return;

      const resident = await deps.repository.findResidentByMaxUserId(request.max.userId);

      if (resident) assertApartment(resident);
    });

    /** Выход: токен перестаёт работать сразу, а не через двенадцать часов. */
    scope.post('/api/me/logout', async (request, reply) => {
      await auth.revoke(request.maxSessionToken);

      return reply.code(204).send();
    });

    for (const area of [
      meRoutes,
      requestRoutes,
      billingRoutes,
      meterRoutes,
      votingRoutes,
      deviceRoutes,
      staffRoutes,
      buildingRoutes,
      broadcastRoutes,
      houseRoutes,
      capitalRoutes,
      complaintRoutes,
      handoverRoutes,
      stickerRoutes,
      supportRoutes,
      visitRoutes,
      handoffRoutes,
      voiceRoutes,
    ]) {
      await scope.register(area, { ...deps, auth });
    }
  });
};

export interface HealthOptions {
  /** Проверка хранилища. */
  storage?: () => Promise<unknown>;
  now?: () => number;
  /** Как часто ходить в базу. Проверку живости дёргают каждые несколько секунд. */
  cacheMs?: number;
}

/** Сколько держать прошлый ответ проверки живости. */
const HEALTH_CACHE_MS = 2000;

/** Проверка живости для мониторинга, вне защищённой области. */
export const health: FastifyPluginAsync<HealthOptions> = async (fastify, options) => {
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? HEALTH_CACHE_MS;
  let checkedAt = 0;
  let storageOk = true;

  const probe = async (): Promise<boolean> => {
    if (!options.storage) return true;

    const at = now();

    if (at - checkedAt < cacheMs) return storageOk;

    checkedAt = at;

    try {
      await options.storage();
      storageOk = true;
    } catch (error) {
      fastify.log.error(error, 'хранилище недоступно');
      storageOk = false;
    }

    return storageOk;
  };

  fastify.get('/health', async (_request, reply) => {
    const ok = await probe();

    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      storage: ok ? 'ok' : 'unavailable',
    });
  });
};
