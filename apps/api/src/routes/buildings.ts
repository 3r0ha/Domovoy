import {
  importApartments,
  importEquipment,
  openBuilding,
  releaseHouseChat,
  updateBuilding,
  checkInspectionItem,
  listInspections,
  proveInspection,
  portfolio,
  listAnnouncementsFor,
  listServedBuildings,
  publishAnnouncement,
  type BuildingCard,
} from '@domovoy/app';
import {
  DomainError,
  MESSAGE_MAX_LENGTH,
  type RequestCategory,
} from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';
import {
  announcementSchema,
  attachmentsBodySchema,
  buildingIdSchema,
  CATEGORIES,
  contactSchema,
  houseCardSchema,
  houseSchema,
  serviceSchema,
  inspectionSchema,
  serializeAnnouncement,
  serializeInspection,
} from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Дома компании: карточка, импорт, объявления и осмотры. */
export const buildingRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

    scope.get<{ Querystring: { buildingId?: string; before?: string } }>(
      '/api/announcements',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: { buildingId: buildingIdSchema, before: { type: 'string', format: 'date-time' } },
          },
          response: { 200: { type: 'array', items: announcementSchema } },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const found = await listAnnouncementsFor(deps, resident, {
          ...(request.query.before ? { before: new Date(request.query.before) } : {}),
        });

        return found.map(serializeAnnouncement);
      },
    );

    /** Осмотры общего имущества: что обойти и что уже отмечено. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/inspections',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: { 200: { type: 'array', items: inspectionSchema } },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        const now = deps.now();
        const buildingId = resident.buildingId ?? deps.defaultBuildingId;
        const equipment = new Map(
          (await deps.repository.listEquipment(buildingId)).map((item) => [item.code, item.title]),
        );

        return (await listInspections(deps, resident)).map((inspection) =>
          serializeInspection(inspection, now, equipment),
        );
      },
    );

    /** Отметка о выезде: мастер сканирует наклейку того объекта, который осматривает. */
    scope.post<{ Params: { id: string }; Body: { code: string } }>(
      '/api/inspections/:id/prove',
      {
        schema: {
          body: { type: 'object', required: ['code'], properties: { code: { type: 'string', maxLength: 512 } } },
          response: { 200: inspectionSchema },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        const inspection = await proveInspection(deps, {
          resident,
          inspectionId: request.params.id,
          code: request.body.code,
        });

        return serializeInspection(inspection, deps.now());
      },
    );

    /** Отметка пункта осмотра. */
    scope.post<{
      Params: { id: string; index: string };
      Body: {
        state: 'ok' | 'problem';
        comment?: string;
        attachments?: { kind: 'photo' | 'voice' | 'file'; token: string; transcript?: string }[];
      };
    }>(
      '/api/inspections/:id/items/:index',
      {
        schema: {
          body: {
            type: 'object',
            required: ['state'],
            properties: {
              state: { type: 'string', enum: ['ok', 'problem'] },
              comment: { type: 'string', maxLength: MESSAGE_MAX_LENGTH },
              attachments: attachmentsBodySchema,
            },
          },
          response: {
            200: {
              type: 'object',
              required: ['inspection'],
              properties: { inspection: inspectionSchema, requestId: { type: 'string' } },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        const result = await checkInspectionItem(deps, {
          resident,
          inspectionId: request.params.id,
          index: Number(request.params.index),
          state: request.body.state,
          ...(request.body.comment === undefined ? {} : { comment: request.body.comment }),
          ...(request.body.attachments === undefined ? {} : { attachments: request.body.attachments }),
        });

        return {
          inspection: serializeInspection(result.inspection),
          ...(result.requestId ? { requestId: result.requestId } : {}),
        };
      },
    );

    /** Дома компании в одном списке, худшие сверху. */
    scope.get<{ Querystring: { days?: number } }>(
      '/api/buildings/report',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: { days: { type: 'integer', minimum: 1, maximum: 365 } },
          },
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  buildingId: { type: 'string' },
                  code: { type: 'string' },
                  address: { type: 'string' },
                  open: { type: 'integer' },
                  overdue: { type: 'integer' },
                  created: { type: 'integer' },
                  inTimeRate: { type: 'number' },
                  averageRating: { type: 'number' },
                },
              },
            },
          },
        },
      },
      async (request) => portfolio(deps, await currentResident(request.max.userId), request.query.days),
    );

    /** Карточка дома: адрес, код для номеров заявок и часовой пояс. */
    scope.post<{
      Querystring: { buildingId?: string };
      Body: {
        code?: string;
        address?: string;
        managementCompany?: string;
        timeZone?: string;
        contact?: { name: string; role?: string; phone?: string; email?: string };
        service?: {
          emergencyPhone?: string;
          phone?: string;
          email?: string;
          hours?: string;
          office?: string;
          officeHours?: string;
        };
        reception?: { weekday: number; from: string; to: string }[];
        visitMinutes?: number;
        partners?: { kind: string; title: string; categories?: string[]; phone?: string; email?: string; channel?: string }[];
      };
    }>(
      '/api/buildings/card',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          body: houseCardSchema,
          response: { 200: houseSchema },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const saved = await updateBuilding(deps, resident, request.body as BuildingCard);

        return { ...saved, chatBound: saved.chatId !== undefined };
      },
    );

    /** Ещё один дом компании: с него начинается работа по новому адресу. */
    scope.post<{
      Querystring: { buildingId?: string };
      Body: { code: string; address?: string; timeZone?: string };
    }>(
      '/api/buildings',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          body: {
            type: 'object',
            required: ['code'],
            properties: {
              code: { type: 'string', minLength: 1, maxLength: 16 },
              address: { type: 'string', maxLength: 200 },
              timeZone: { type: 'string', maxLength: 64 },
            },
          },
          response: {
            200: {
              type: 'object',
              required: ['id', 'code', 'address', 'chatBound'],
              properties: {
                id: { type: 'string' },
                code: { type: 'string' },
                address: { type: 'string' },
                managementCompany: { type: 'string' },
                timeZone: { type: 'string' },
                chatBound: { type: 'boolean' },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const building = await openBuilding(deps, resident, request.body);

        return { ...building, chatBound: false };
      },
    );

    /** Отвязать чат дома: бот остаётся в чате, но объявления туда больше не идут. */
    scope.delete<{ Querystring: { buildingId?: string } }>(
      '/api/buildings/chat',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: {
            200: {
              type: 'object',
              required: ['id', 'code', 'address', 'chatBound'],
              properties: {
                id: { type: 'string' },
                code: { type: 'string' },
                address: { type: 'string' },
                managementCompany: { type: 'string' },
                timeZone: { type: 'string' },
                chatBound: { type: 'boolean' },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const building = await releaseHouseChat(deps, resident);

        return { ...building, chatBound: building.chatId !== undefined };
      },
    );

    /** Оборудование дома: от вида зависит регламент обслуживания. */
    scope.post<{ Querystring: { buildingId?: string }; Body: { csv: string } }>(
      '/api/import/equipment',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          body: { type: 'object', required: ['csv'], properties: { csv: { type: 'string', maxLength: 200_000 } } },
          response: {
            200: {
              type: 'object',
              required: ['added', 'problems'],
              properties: {
                added: { type: 'integer' },
                problems: {
                  type: 'array',
                  items: { type: 'object', properties: { line: { type: 'integer' }, message: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        return importEquipment(deps, resident, request.body.csv);
      },
    );

    /** Заведение дома списком квартир из выгрузки. */
    scope.post<{ Querystring: { buildingId?: string }; Body: { csv: string } }>(
      '/api/import/apartments',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          body: { type: 'object', required: ['csv'], properties: { csv: { type: 'string', maxLength: 2_000_000 } } },
          response: {
            200: {
              type: 'object',
              required: ['added', 'updated', 'meters', 'problems'],
              properties: {
                added: { type: 'integer' },
                updated: { type: 'integer' },
                meters: { type: 'integer' },
                problems: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { line: { type: 'integer' }, message: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        return importApartments(deps, resident, request.body.csv);
      },
    );

    /** Дома, доступные человеку. */
    scope.get(
      '/api/buildings',
      {
        schema: {
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'code', 'address', 'current', 'chatBound'],
                properties: {
                  id: { type: 'string' },
                  code: { type: 'string' },
                  address: { type: 'string' },
                  current: { type: 'boolean' },
                  timeZone: { type: 'string' },
                  managementCompany: { type: 'string' },
                  chatBound: { type: 'boolean' },
                  contact: contactSchema,
                  service: serviceSchema,
                },
              },
            },
          },
        },
      },
      async (request) => listServedBuildings(deps, await currentResident(request.max.userId)),
    );

    scope.post<{
      Querystring: { buildingId?: string };
      Body: {
        title: string;
        body: string;
        entrance?: number;
        riser?: number;
        works?: { category: RequestCategory; from: string; until: string };
      };
    }>(
      '/api/announcements',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          body: {
            type: 'object',
            required: ['title', 'body'],
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 200 },
              body: { type: 'string', minLength: 1, maxLength: 4000 },
              entrance: { type: 'integer', minimum: 1 },
              riser: { type: 'integer', minimum: 1 },
              works: {
                type: 'object',
                required: ['category', 'from', 'until'],
                properties: {
                  category: { type: 'string', enum: CATEGORIES },
                  from: { type: 'string', format: 'date-time' },
                  until: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const works = request.body.works;

        if (works && new Date(works.until).getTime() <= new Date(works.from).getTime()) {
          throw new DomainError('bad_works', 'Работы должны заканчиваться позже, чем начинаются');
        }

        const published = await publishAnnouncement(deps, {
          resident,
          title: request.body.title,
          body: request.body.body,
          ...(request.body.entrance !== undefined ? { entrance: request.body.entrance } : {}),
          ...(request.body.riser !== undefined ? { riser: request.body.riser } : {}),
          ...(works
            ? { works: { category: works.category, from: new Date(works.from), until: new Date(works.until) } }
            : {}),
        });

        return reply.code(201).send({
          id: published.announcement.id,
          audience: published.description,
          recipients: published.announcement.recipientIds.length,
        });
      },
    );
};
