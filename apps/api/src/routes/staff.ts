import {
  bindApartmentByStaff,
  AUDIT_ACTIONS,
  listAudit,
  assignRole,
  listApartmentsFor,
  listAssignable,
  listPeople,
  listUnbound,
  setDuty,
  setServedBuildings,
  unbindApartment,
} from '@domovoy/app';
import {
  ROLES,
  type Role,
} from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';
import {
  boundApartmentSchema,
  buildingIdSchema,
  buildingQuerySchema,
  idParamsSchema,
} from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Люди дома: роли, дежурство, привязка и журнал. */
export const staffRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

    /** Кому можно поручить работу, вместе с текущей загрузкой. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/staff',
      {
        schema: {
          querystring: buildingQuerySchema,
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'displayName', 'role', 'load'],
                properties: {
                  id: { type: 'string' },
                  displayName: { type: 'string' },
                  role: { type: 'string' },
                  load: { type: 'integer' },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        return listAssignable(deps, resident);
      },
    );

    /** Жильцы, которых управляющая организация ещё не связала с квартирой. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/residents/unbound',
      {
        schema: {
          querystring: buildingQuerySchema,
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'displayName'],
                properties: { id: { type: 'string' }, displayName: { type: 'string' } },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        return listUnbound(deps, resident);
      },
    );

    /** Люди дома: жильцы и сотрудники. Нужен там, где раздают роли. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/residents',
      {
        schema: {
          querystring: buildingQuerySchema,
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'displayName', 'role'],
                properties: {
                  id: { type: 'string' },
                  displayName: { type: 'string' },
                  role: { type: 'string' },
                  apartmentId: { type: 'string' },
                  apartmentNumber: { type: 'integer' },
                  onDuty: { type: 'boolean' },
                  buildingIds: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        return listPeople(deps, resident);
      },
    );

    /** Назначение роли. */
    scope.post<{ Params: { id: string }; Body: { role: Role } }>(
      '/api/residents/:id/role',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['role'],
            additionalProperties: false,
            properties: { role: { type: 'string', enum: ROLES } },
          },
        },
      },
      async (request) => {
        const manager = await currentResident(request.max.userId);

        return assignRole(deps, manager, { residentId: request.params.id, role: request.body.role });
      },
    );

    /** Дежурство. */
    scope.post<{ Params: { id: string }; Body: { onDuty: boolean } }>(
      '/api/residents/:id/duty',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['onDuty'],
            additionalProperties: false,
            properties: { onDuty: { type: 'boolean' } },
          },
        },
      },
      async (request) => {
        const staff = await currentResident(request.max.userId);

        return setDuty(deps, staff, { residentId: request.params.id, onDuty: request.body.onDuty });
      },
    );

    /** Дома, которые обслуживает сотрудник. */
    scope.post<{ Params: { id: string }; Body: { buildingIds: string[] } }>(
      '/api/residents/:id/buildings',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['buildingIds'],
            additionalProperties: false,
            properties: { buildingIds: { type: 'array', maxItems: 200, items: buildingIdSchema } },
          },
        },
      },
      async (request) => {
        const manager = await currentResident(request.max.userId);

        return setServedBuildings(deps, manager, {
          residentId: request.params.id,
          buildingIds: request.body.buildingIds,
        });
      },
    );

    /** Жилец съехал: квартира освобождается, история дома остаётся. */
    scope.post<{ Params: { id: string }; Body?: { apartmentId?: string } }>(
      '/api/residents/:id/unbind',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            additionalProperties: false,
            properties: { apartmentId: { type: 'string', minLength: 1, maxLength: 128 } },
          },
        },
      },
      async (request) => {
        const actor = await currentResident(request.max.userId);
        const apartmentId = typeof request.body?.apartmentId === 'string' ? request.body.apartmentId : undefined;
        const saved = await unbindApartment(deps, actor, request.params.id, apartmentId);

        return { id: saved.id, displayName: saved.displayName, role: saved.role };
      },
    );

    /** Квартиры дома для выбора при привязке. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/apartments',
      {
        schema: {
          querystring: buildingQuerySchema,
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'number', 'entrance', 'riser'],
                properties: {
                  id: { type: 'string' },
                  number: { type: 'integer' },
                  entrance: { type: 'integer' },
                  riser: { type: 'integer' },
                  code: { type: 'string' },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        return listApartmentsFor(deps, resident);
      },
    );

    /** Привязка жильца сотрудником. */
    scope.post<{ Params: { id: string }; Body: { apartmentId: string } }>(
      '/api/residents/:id/apartment',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['apartmentId'],
            additionalProperties: false,
            properties: { apartmentId: { type: 'string', minLength: 1, maxLength: 128 } },
          },
          response: { 200: boundApartmentSchema },
        },
      },
      async (request) => {
        const staff = await currentResident(request.max.userId);

        const bound = await bindApartmentByStaff(deps, staff, {
          residentId: request.params.id,
          apartmentId: request.body.apartmentId,
        });

        return {
          apartmentId: bound.apartment.id,
          number: bound.apartment.number,
          alreadyBound: bound.alreadyBound,
        };
      },
    );

    /** Журнал действий сотрудников: смотрит управляющий. */
    scope.get<{ Querystring: { buildingId?: string; before?: string } }>(
      '/api/audit',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: { buildingId: buildingIdSchema, before: { type: 'string', format: 'date-time' } },
          },
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'at', 'actorName', 'action', 'actionTitle'],
                properties: {
                  id: { type: 'string' },
                  at: { type: 'string' },
                  actorName: { type: 'string' },
                  action: { type: 'string' },
                  actionTitle: { type: 'string' },
                  subject: { type: 'string' },
                  details: { type: 'string' },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const entries = await listAudit(deps, resident, {
          ...(request.query.before ? { before: new Date(request.query.before) } : {}),
        });

        return entries.map((entry) => ({
          id: entry.id,
          at: entry.at.toISOString(),
          actorName: entry.actorName,
          action: entry.action,
          actionTitle: AUDIT_ACTIONS[entry.action],
          ...(entry.subject ? { subject: entry.subject } : {}),
          ...(entry.details ? { details: entry.details } : {}),
        }));
      },
    );

};
