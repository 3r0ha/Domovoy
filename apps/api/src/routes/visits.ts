import {
  dropVisit,
  listVisitsFor,
  markVisitDone,
  receptionFor,
  recordVisit,
  setReception,
  speak,
  takeVisit,
  zoneOf,
} from '@domovoy/app';
import {
  TOPIC_MAX_LENGTH,
  VISIT_MINUTES_RANGE,
  formatClock,
  formatReception,
  formatWeekday,
  type Visit,
} from '@domovoy/domain';
import type { Translate } from '@domovoy/i18n';
import type { FastifyPluginAsync } from 'fastify';

import {
  buildingQuerySchema,
  idParamsSchema,
  receptionSchema,
  receptionWindowsSchema,
  visitSchema,
} from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/**
 * Приём в управляющей организации: свободные часы, запись и её отмена.
 * Записаться на приём через MAX требует порядок информационного взаимодействия
 * (приказ Минстроя России № 856/пр).
 */
export const visitRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  const serialize = (
    visit: Visit,
    zone: string,
    t: Translate,
    who?: { residentName?: string; apartment?: number },
  ) => ({
    id: visit.id,
    at: visit.at.toISOString(),
    minutes: visit.minutes,
    topic: visit.topic,
    status: visit.status,
    day: formatWeekday(visit.at, zone, t),
    clock: formatClock(visit.at, zone, t),
    ...(who?.residentName ? { residentName: who.residentName } : {}),
    ...(who?.apartment === undefined ? {} : { apartment: who.apartment }),
  });

  /** Свободные часы приёма и своя запись. */
  scope.get<{ Querystring: { buildingId?: string } }>(
    '/api/reception',
    {
      schema: {
        querystring: buildingQuerySchema,
        response: { 200: receptionSchema },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);
      const reception = await receptionFor(deps, resident, request.query.buildingId);
      const zone = await zoneOf(deps, reception.buildingId);

      return {
        buildingId: reception.buildingId,
        minutes: reception.minutes,
        hours: formatReception(reception.windows),
        windows: reception.windows,
        ...(reception.office ? { office: reception.office } : {}),
        // У часа приёма стоит день недели: приём идёт по вторникам и четвергам,
        // и по одной дате человек не поймёт, когда именно прийти.
        slots: reception.slots.map((at) => ({
          at: at.toISOString(),
          day: formatWeekday(at, zone, speak(resident)),
          clock: formatClock(at, zone, speak(resident)),
        })),
        ...(reception.mine ? { mine: serialize(reception.mine, zone, speak(resident)) } : {}),
      };
    },
  );

  /** Приёмные часы дома: задаёт смена своего дома. */
  scope.post<{
    Querystring: { buildingId?: string };
    Body: { windows: { weekday: number; from: string; to: string }[]; minutes?: number };
  }>(
    '/api/reception',
    {
      schema: {
        querystring: buildingQuerySchema,
        body: {
          type: 'object',
          required: ['windows'],
          additionalProperties: false,
          properties: {
            windows: receptionWindowsSchema,
            minutes: { type: 'integer', minimum: VISIT_MINUTES_RANGE.min, maximum: VISIT_MINUTES_RANGE.max },
          },
        },
        response: { 200: receptionSchema },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);

      const reception = await setReception(deps, {
        staff: resident,
        windows: request.body.windows,
        ...(request.body.minutes === undefined ? {} : { minutes: request.body.minutes }),
        ...(request.query.buildingId ? { buildingId: request.query.buildingId } : {}),
      });

      const zone = await zoneOf(deps, reception.buildingId);

      return {
        buildingId: reception.buildingId,
        minutes: reception.minutes,
        hours: formatReception(reception.windows),
        windows: reception.windows,
        ...(reception.office ? { office: reception.office } : {}),
        slots: reception.slots.map((at) => ({
          at: at.toISOString(),
          day: formatWeekday(at, zone, speak(resident)),
          clock: formatClock(at, zone, speak(resident)),
        })),
      };
    },
  );

  /** Пришедшего без записи записывает сотрудник. */
  scope.post<{
    Querystring: { buildingId?: string };
    Body: { residentId: string; topic: string; at?: string };
  }>(
    '/api/visits/record',
    {
      schema: {
        querystring: buildingQuerySchema,
        body: {
          type: 'object',
          required: ['residentId', 'topic'],
          additionalProperties: false,
          properties: {
            residentId: { type: 'string', minLength: 1, maxLength: 128 },
            topic: { type: 'string', minLength: 1, maxLength: TOPIC_MAX_LENGTH },
            at: { type: 'string', format: 'date-time' },
          },
        },
        response: { 201: visitSchema },
      },
    },
    async (request, reply) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);

      const visit = await recordVisit(deps, {
        staff: resident,
        residentId: request.body.residentId,
        topic: request.body.topic,
        ...(request.body.at ? { at: new Date(request.body.at) } : {}),
        ...(request.query.buildingId ? { buildingId: request.query.buildingId } : {}),
      });

      return reply.code(201).send(serialize(visit, await zoneOf(deps, visit.buildingId), speak(resident)));
    },
  );

  /** Записи на приём: смене по дому, жильцу свои. */
  scope.get<{ Querystring: { buildingId?: string } }>(
    '/api/visits',
    {
      schema: {
        querystring: buildingQuerySchema,
        response: { 200: { type: 'array', items: visitSchema } },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);
      const cards = await listVisitsFor(deps, resident, request.query.buildingId);
      const zone = await zoneOf(deps, resident.buildingId ?? deps.defaultBuildingId);

      return cards.map((card) => serialize(card.visit, zone, speak(resident), card));
    },
  );

  scope.post<{ Querystring: { buildingId?: string }; Body: { at: string; topic: string } }>(
    '/api/visits',
    {
      schema: {
        querystring: buildingQuerySchema,
        body: {
          type: 'object',
          required: ['at', 'topic'],
          additionalProperties: false,
          properties: {
            at: { type: 'string', format: 'date-time' },
            topic: { type: 'string', minLength: 1, maxLength: TOPIC_MAX_LENGTH },
          },
        },
        response: { 201: visitSchema },
      },
    },
    async (request, reply) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);

      const visit = await takeVisit(deps, {
        resident,
        at: new Date(request.body.at),
        topic: request.body.topic,
        ...(request.query.buildingId ? { buildingId: request.query.buildingId } : {}),
      });

      return reply.code(201).send(serialize(visit, await zoneOf(deps, visit.buildingId), speak(resident)));
    },
  );

  scope.post<{ Params: { id: string } }>(
    '/api/visits/:id/cancel',
    { schema: { params: idParamsSchema, response: { 200: visitSchema } } },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const visit = await dropVisit(deps, resident, request.params.id);

      return serialize(visit, await zoneOf(deps, visit.buildingId), speak(resident));
    },
  );

  /** Приём состоялся: отмечает смена. */
  scope.post<{ Params: { id: string } }>(
    '/api/visits/:id/done',
    { schema: { params: idParamsSchema, response: { 200: visitSchema } } },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const visit = await markVisitDone(deps, resident, request.params.id);

      return serialize(visit, await zoneOf(deps, visit.buildingId), speak(resident));
    },
  );
};
