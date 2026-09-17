import { dropVisit, listVisitsFor, markVisitDone, receptionFor, takeVisit, zoneOf } from '@domovoy/app';
import { TOPIC_MAX_LENGTH, formatClock, formatReception, formatWeekday, type Visit } from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';

import { buildingIdSchema, receptionSchema, visitSchema } from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/**
 * Приём в управляющей организации: свободные часы, запись и её отмена.
 * Записаться на приём через MAX требует порядок информационного взаимодействия
 * (приказ Минстроя России № 856/пр).
 */
export const visitRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  const serialize = (visit: Visit, zone: string, who?: { residentName?: string; apartment?: number }) => ({
    id: visit.id,
    at: visit.at.toISOString(),
    minutes: visit.minutes,
    topic: visit.topic,
    status: visit.status,
    day: formatWeekday(visit.at, zone),
    clock: formatClock(visit.at, zone),
    ...(who?.residentName ? { residentName: who.residentName } : {}),
    ...(who?.apartment === undefined ? {} : { apartment: who.apartment }),
  });

  /** Свободные часы приёма и своя запись. */
  scope.get<{ Querystring: { buildingId?: string } }>(
    '/api/reception',
    {
      schema: {
        querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
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
        ...(reception.office ? { office: reception.office } : {}),
        // У часа приёма стоит день недели: приём идёт по вторникам и четвергам,
        // и по одной дате человек не поймёт, когда именно прийти.
        slots: reception.slots.map((at) => ({
          at: at.toISOString(),
          day: formatWeekday(at, zone),
          clock: formatClock(at, zone),
        })),
        ...(reception.mine ? { mine: serialize(reception.mine, zone) } : {}),
      };
    },
  );

  /** Записи на приём: смене по дому, жильцу свои. */
  scope.get<{ Querystring: { buildingId?: string } }>(
    '/api/visits',
    {
      schema: {
        querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
        response: { 200: { type: 'array', items: visitSchema } },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);
      const cards = await listVisitsFor(deps, resident, request.query.buildingId);
      const zone = await zoneOf(deps, resident.buildingId ?? deps.defaultBuildingId);

      return cards.map((card) => serialize(card.visit, zone, card));
    },
  );

  scope.post<{ Querystring: { buildingId?: string }; Body: { at: string; topic: string } }>(
    '/api/visits',
    {
      schema: {
        querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
        body: {
          type: 'object',
          required: ['at', 'topic'],
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

      return reply.code(201).send(serialize(visit, await zoneOf(deps, visit.buildingId)));
    },
  );

  scope.post<{ Params: { id: string } }>(
    '/api/visits/:id/cancel',
    { schema: { response: { 200: visitSchema } } },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const visit = await dropVisit(deps, resident, request.params.id);

      return serialize(visit, await zoneOf(deps, visit.buildingId));
    },
  );

  /** Приём состоялся: отмечает смена. */
  scope.post<{ Params: { id: string } }>(
    '/api/visits/:id/done',
    { schema: { response: { 200: visitSchema } } },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const visit = await markVisitDone(deps, resident, request.params.id);

      return serialize(visit, await zoneOf(deps, visit.buildingId));
    },
  );
};
