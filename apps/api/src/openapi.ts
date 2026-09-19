import type { FastifyInstance, RouteOptions } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Маршрут открыт: сессия ему не нужна. */
    open?: boolean;
  }
}

export interface OpenApiOptions {
  title?: string;
  version?: string;
  description?: string;
}

/** Схема одного места запроса: тело, строка запроса, параметры пути. */
type JsonSchema = Record<string, unknown>;

interface RouteSchema {
  body?: JsonSchema;
  querystring?: JsonSchema;
  params?: JsonSchema;
  response?: Record<string, JsonSchema>;
}

interface Collected {
  method: string;
  path: string;
  schema: RouteSchema;
  /** Маршрут открыт: сессия ему не нужна. */
  open: boolean;
}

/** Адрес Fastify (`/api/requests/:id`) в записи OpenAPI (`/api/requests/{id}`). */
const toOpenApiPath = (url: string): string => url.replace(/:([^/]+)/g, '{$1}');

const pathParams = (url: string): string[] => [...url.matchAll(/:([^/]+)/g)].map((match) => match[1] ?? '');

const properties = (schema: JsonSchema | undefined): Record<string, JsonSchema> =>
  (schema?.['properties'] as Record<string, JsonSchema> | undefined) ?? {};

const required = (schema: JsonSchema | undefined): string[] => (schema?.['required'] as string[] | undefined) ?? [];

/** Описание запроса: параметры пути и строки запроса. */
const parametersOf = (route: Collected): JsonSchema[] => {
  const query = properties(route.schema.querystring);
  const queryRequired = required(route.schema.querystring);

  return [
    ...pathParams(route.path).map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: properties(route.schema.params)[name] ?? { type: 'string' },
    })),
    ...Object.entries(query).map(([name, schema]) => ({
      name,
      in: 'query',
      required: queryRequired.includes(name),
      schema,
    })),
  ];
};

const responsesOf = (route: Collected): JsonSchema => {
  const described: Record<string, JsonSchema> = {};

  for (const [code, schema] of Object.entries(route.schema.response ?? {})) {
    described[code] = { description: 'Успешный ответ', content: { 'application/json': { schema } } };
  }

  const listed =
    Object.keys(described).length > 0 ? described : { '200': { description: 'Успешный ответ' } };

  return {
    ...listed,
    '400': { description: 'Запрос не прошёл проверку схемы или правило предметной области' },
    '401': { description: 'Нет сессии либо профиль за токеном не найден' },
    '403': { description: 'Роль не вправе выполнить действие' },
    '404': { description: 'Объект не найден или не виден этому человеку' },
    '409': { description: 'Состояние объекта не позволяет выполнить действие' },
    '413': { description: 'Вложение или сообщение больше разрешённого' },
    '415': { description: 'Тип содержимого запроса сервер не разбирает' },
    '429': { description: 'Превышена частота запросов' },
    '503': { description: 'Подключённая служба не отвечает' },
  };
};

/** Описание API в формате OpenAPI. */
export const applyOpenApi = (fastify: FastifyInstance, options: OpenApiOptions = {}): void => {
  const routes: Collected[] = [];

  fastify.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];

    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      if (route.url === '/openapi.json') continue;
      if (route.url.includes('*')) continue;

      routes.push({
        method: method.toLowerCase(),
        path: route.url,
        schema: (route.schema ?? {}) as RouteSchema,
        open: route.config?.open === true,
      });
    }
  });

  fastify.get('/openapi.json', async () => {
    const paths: Record<string, Record<string, unknown>> = {};

    for (const route of routes) {
      const path = toOpenApiPath(route.path);
      // Маршрут, который отмечен открытым, сессии не требует: так он и зарегистрирован.
      const secured = path.startsWith('/api/') && !route.open;

      paths[path] = {
        ...paths[path],
        [route.method]: {
          parameters: parametersOf(route),
          ...(route.schema.body
            ? { requestBody: { required: true, content: { 'application/json': { schema: route.schema.body } } } }
            : {}),
          responses: responsesOf(route),
          ...(secured ? { security: [{ session: [] }] } : { security: [] }),
        },
      };
    }

    return {
      openapi: '3.1.0',
      info: {
        title: options.title ?? 'Домовой',
        version: options.version ?? '0.1.0',
        description:
          options.description ??
          'Заявки в управляющую компанию, счётчики, объявления и собрания собственников. ' +
            'Описание собрано из схем, по которым сервер проверяет запросы.',
      },
      components: {
        securitySchemes: {
          session: {
            type: 'http',
            scheme: 'bearer',
            description: 'Токен сессии из POST /auth/session',
          },
        },
      },
      paths,
    };
  });
};
