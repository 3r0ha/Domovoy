import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { SessionError, type SessionAuth, type SessionRecord } from './session-auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Сессия, выданная в обмен на параметры запуска. */
    maxSession: SessionRecord;
  }
}

export interface MaxSessionOptions {
  auth: SessionAuth;
  /** Как достать токен из запроса. По умолчанию, `Authorization: Bearer <token>`. */
  getToken?: (request: FastifyRequest) => string | null | undefined;
  /** Маршруты без авторизации: выдача сессии, health-чеки. */
  skip?: (request: FastifyRequest) => boolean;
}

const bearerToken = (request: FastifyRequest): string | null => {
  const header = request.headers['authorization'] as string | string[] | undefined;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return null;

  const [scheme, token] = value.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;

  return token;
};

const plugin: FastifyPluginAsync<MaxSessionOptions> = async (fastify, options) => {
  if (!fastify.hasRequestDecorator('max')) fastify.decorateRequest('max');
  if (!fastify.hasRequestDecorator('maxSession')) fastify.decorateRequest('maxSession');

  fastify.addHook('onRequest', async (request, reply) => {
    if (options.skip?.(request)) return;

    const token = (options.getToken ?? bearerToken)(request);

    try {
      const session = await options.auth.verify(token);

      request.maxSession = session;
      request.max = { data: session.data, userId: session.userId, raw: session.initData };
    } catch (error) {
      if (error instanceof SessionError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }

      throw error;
    }
  });
};

/** Авторизация по сессионному токену для маршрутов текущей области видимости. */
export const maxSession = fp(plugin, {
  name: '@maxkit/server/max-session',
  fastify: '5.x',
});
