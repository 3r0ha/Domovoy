import type { FastifyPluginAsync, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';

import { InitDataError, validateInitData, type ValidateInitDataOptions, type ValidatedInitData } from './init-data.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Проверенные параметры запуска мини-приложения. Заполняется только на защищённых маршрутах. */
    max: ValidatedInitData;
  }
}

export const DEFAULT_INIT_DATA_HEADER = 'x-max-init-data';

export interface MaxAuthOptions extends ValidateInitDataOptions {
  /** Заголовок с сырой строкой `WebAppData`. */
  header?: string;
  /** Своя логика извлечения строки запуска, например, из cookie или тела запроса. */
  getInitData?: (request: FastifyRequest) => string | undefined | null;
  /** Маршруты, которым авторизация не нужна: health-чеки, вебхук бота. */
  skip?: (request: FastifyRequest) => boolean;
}

const extract = (request: FastifyRequest, options: MaxAuthOptions): string | null => {
  if (options.getInitData) return options.getInitData(request) ?? null;

  const raw = request.headers[options.header ?? DEFAULT_INIT_DATA_HEADER];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
};

const plugin: FastifyPluginAsync<MaxAuthOptions> = async (fastify, options) => {
  if (!options.botToken) throw new Error('maxAuth: не передан botToken');

  if (!fastify.hasRequestDecorator('max')) {
    fastify.decorateRequest('max');
  }

  fastify.addHook('onRequest', async (request, reply) => {
    if (options.skip?.(request)) return;

    try {
      request.max = validateInitData(extract(request, options), options);
    } catch (error) {
      if (error instanceof InitDataError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });
};

/** Проверка подписи мини-приложения для маршрутов текущей области видимости. */
export const maxAuth = fp(plugin, {
  name: '@maxkit/server/max-auth',
  fastify: '5.x',
});

/** Та же проверка, но как preHandler для отдельного маршрута. */
export const createMaxAuthHandler = (options: MaxAuthOptions): preHandlerAsyncHookHandler => {
  return async (request, reply) => {
    try {
      request.max = validateInitData(extract(request, options), options);
    } catch (error) {
      if (error instanceof InitDataError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  };
};
