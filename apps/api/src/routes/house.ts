import {
  announcementAudience,
  contactsFor,
  summariseReport,
  buildingReport,
  equipmentHealth,
  houseQuality,
  houseAhead,
  houseNow,
  housePlan,
  exportRequests,
  sendRequestsExport,
  requestsTable,
  waitingHandoffs,
} from '@domovoy/app';
import {
  BASIS,
  describeAudience,
  describeTarget,
  reportersCount,
} from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';
import {
  alertSchema,
  asTitle,
  buildingIdSchema,
  contactsSchema,
  reportSchema,
  serializeHandoff,
} from '../serialize.js';
import { buildXlsx } from '../xlsx.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Дом целиком: сводки, план, оборудование и лента. */
export const houseRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

    /** Сводка по дому. */
    scope.get<{ Querystring: { days?: number; buildingId?: string } }>(
      '/api/report',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: { days: { type: 'integer', minimum: 1, maximum: 365 }, buildingId: buildingIdSchema },
          },
          response: { 200: reportSchema },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const report = await buildingReport(deps, resident, request.query.days);
        const now = deps.now();

        // Переданное смежным организациям из виду не теряется: у него свой срок.
        const waiting = await waitingHandoffs(deps, resident, request.query.buildingId);

        // Пересказ идёт отдельным запросом: числа считает продукт, и ждать
        // из-за них ответа модели смене незачем.
        return {
          ...report,
          objects: report.objects.map((object) => ({ ...object, title: asTitle(object.title) })),
          incidents: report.incidents.map((incident) => ({ ...incident, target: asTitle(incident.target) })),
          ...(waiting.length > 0 ? { handoffs: waiting.map((handoff) => serializeHandoff(handoff, now)) } : {}),
        };
      },
    );

    /** Пересказ сводки словами: числа в нём те же, что в самой сводке. */
    scope.get<{ Querystring: { days?: number; buildingId?: string } }>(
      '/api/report/digest',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: { days: { type: 'integer', minimum: 1, maximum: 365 }, buildingId: buildingIdSchema },
          },
          response: {
            200: {
              type: 'object',
              properties: { digest: { type: 'string' }, basis: { type: 'string' } },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const report = await buildingReport(deps, resident, request.query.days);
        const digest = await summariseReport(report, deps.reasoner);

        return digest ? { digest, basis: BASIS.modelDigest } : {};
      },
    );

    /** Как работает управляющая компания в доме жильца. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/quality',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: {
            200: {
              type: 'object',
              required: ['buildingId', 'from', 'to', 'open', 'overdue', 'created', 'closed', 'rated'],
              properties: {
                buildingId: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
                open: { type: 'integer' },
                overdue: { type: 'integer' },
                created: { type: 'integer' },
                closed: { type: 'integer' },
                rated: { type: 'integer' },
                inTimeRate: { type: 'number' },
                averageHours: { type: 'number' },
                averageRating: { type: 'number' },
                before: {
                  type: 'object',
                  properties: {
                    closed: { type: 'integer' },
                    inTimeRate: { type: 'number' },
                    averageHours: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const quality = await houseQuality(deps, resident);

        return { ...quality, from: quality.from.toISOString(), to: quality.to.toISOString() };
      },
    );

    /** Реестр заявок за период таблицей. */
    scope.get<{ Querystring: { days?: number; buildingId?: string; from?: string; to?: string } }>(
      '/api/report/requests.csv',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: {
              days: { type: 'integer', minimum: 1, maximum: 365 },
              buildingId: buildingIdSchema,
              from: { type: 'string', format: 'date-time' },
              to: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const range =
          request.query.from && request.query.to
            ? { from: new Date(request.query.from), to: new Date(request.query.to) }
            : request.query.days;
        const exported = await exportRequests(deps, resident, range);

        return reply
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`)
          .send(exported.csv);
      },
    );

    /** Тот же реестр файлом в переписку с ботом: в клиенте MAX так надёжнее. */
    scope.post<{ Querystring: { days?: number; buildingId?: string } }>(
      '/api/report/requests/send',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: { days: { type: 'integer', minimum: 1, maximum: 365 }, buildingId: buildingIdSchema },
          },
          response: {
            200: {
              type: 'object',
              required: ['filename'],
              properties: { filename: { type: 'string' }, messageId: { type: 'string' } },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        return sendRequestsExport(deps, resident, request.query.days);
      },
    );

    /** Тот же реестр книгой Excel. */
    scope.get<{ Querystring: { days?: number; buildingId?: string; from?: string; to?: string } }>(
      '/api/report/requests.xlsx',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: {
              days: { type: 'integer', minimum: 1, maximum: 365 },
              buildingId: buildingIdSchema,
              from: { type: 'string', format: 'date-time' },
              to: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const range =
          request.query.from && request.query.to
            ? { from: new Date(request.query.from), to: new Date(request.query.to) }
            : request.query.days;
        const table = await requestsTable(deps, resident, range);
        const book = buildXlsx([{ name: 'Заявки', rows: [table.columns, ...table.rows] }]);

        return reply
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header(
            'content-disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(`${table.name}.xlsx`)}`,
          )
          .send(book);
      },
    );

    /** План дома: подъезды, стояки и обстановка по квартирам. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/plan',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: {
            200: {
              type: 'object',
              required: ['entrances', 'house'],
              properties: {
                entrances: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      entrance: { type: 'integer' },
                      risers: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            riser: { type: 'integer' },
                            flats: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  number: { type: 'integer' },
                                  state: { type: 'string' },
                                  requestId: { type: 'string' },
                                },
                              },
                            },
                            alerts: { type: 'array', items: alertSchema },
                          },
                        },
                      },
                      alerts: { type: 'array', items: alertSchema },
                    },
                  },
                },
                house: { type: 'array', items: alertSchema },
              },
            },
          },
        },
      },
      async (request) => housePlan(deps, await currentResident(request.max.userId, request.query.buildingId)),
    );

    /** Здоровье оборудования: что сломается следующим. Только смене. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/equipment',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  startParam: { type: 'string' },
                  title: { type: 'string' },
                  failures: { type: 'integer' },
                  lastAt: { type: 'string' },
                  averageDays: { type: 'integer' },
                  dueInDays: { type: 'integer' },
                  broken: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const health = await equipmentHealth(deps, resident);

        return health.map((item) => ({
          ...item,
          ...(item.lastAt ? { lastAt: item.lastAt.toISOString() } : {}),
        }));
      },
    );

    /** Что в доме прямо сейчас: аварии и идущие работы. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/now',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: {
            200: {
              type: 'object',
              required: ['incidents', 'works', 'mood'],
              properties: {
                mood: { type: 'string', enum: ['sleeping', 'walking', 'alarmed'] },
                incidents: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      title: { type: 'string' },
                      target: { type: 'string' },
                      status: { type: 'string' },
                      resolutionDueAt: { type: 'string' },
                      reporters: { type: 'integer' },
                    },
                  },
                },
                works: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      audience: { type: 'string' },
                      until: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const state = await houseNow(deps, resident);

        return {
          mood: state.mood,
          incidents: state.incidents.map((item) => ({
            id: item.id,
            title: item.title,
            target: asTitle(describeTarget(item.target)),
            status: item.status,
            resolutionDueAt: item.resolutionDueAt.toISOString(),
            reporters: reportersCount(item),
          })),
          works: state.works.map((item) => ({
            title: item.title,
            audience: describeAudience(announcementAudience(item)),
            until: item.works!.until.toISOString(),
          })),
        };
      },
    );

    /** Что в доме будет на неделе: работы, собрания и обходы одной лентой. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/ahead',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['kind', 'at', 'title', 'where'],
                properties: {
                  kind: { type: 'string', enum: ['works', 'poll', 'inspection'] },
                  at: { type: 'string' },
                  title: { type: 'string' },
                  where: { type: 'string' },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        return (await houseAhead(deps, resident)).map((event) => ({ ...event, at: event.at.toISOString() }));
      },
    );

    /** К кому обращаться по дому: ответственный от компании и дежурный смены. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/house/contacts',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: { 200: contactsSchema },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        return contactsFor(deps, resident, request.query.buildingId);
      },
    );
};
