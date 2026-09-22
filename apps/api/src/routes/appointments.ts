import {
  disputeRequest,
  dropVisitSlot,
  missedVisit,
  proposeVisit,
  takeVisitSlot,
  workdayFor,
} from '@domovoy/app';
import type { FastifyPluginAsync } from 'fastify';

import { idParamsSchema } from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/**
 * Визит мастера в квартиру, несогласие с отказом и день исполнителя. Всё это
 * живёт вокруг одной заявки, поэтому и ручки стоят рядом.
 */
export const appointmentRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  const visitSchema = {
    type: 'object',
    required: ['requestId'],
    properties: {
      requestId: { type: 'string' },
      at: { type: 'string' },
      slots: { type: 'array', items: { type: 'string' } },
    },
  } as const;

  /** Смена предлагает окна: жилец выбирает одно из них. */
  scope.post<{ Params: { id: string } }>(
    '/api/requests/:id/visit/offer',
    { schema: { params: idParamsSchema, response: { 200: visitSchema } } },
    async (request) => {
      const staff = await currentResident(request.max.userId);
      const updated = await proposeVisit(deps, staff, request.params.id);

      return {
        requestId: updated.id,
        slots: (updated.appointment?.slots ?? []).map((slot) => slot.toISOString()),
      };
    },
  );

  /** Жилец назначает время из предложенных. */
  scope.post<{ Params: { id: string }; Body: { at: string } }>(
    '/api/requests/:id/visit',
    {
      schema: {
        params: idParamsSchema,
        body: { type: 'object', required: ['at'], properties: { at: { type: 'string' } } },
        response: { 200: visitSchema },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const updated = await takeVisitSlot(deps, {
        resident,
        requestId: request.params.id,
        at: new Date(request.body.at),
      });

      return {
        requestId: updated.id,
        ...(updated.appointment?.at ? { at: updated.appointment.at.toISOString() } : {}),
        slots: (updated.appointment?.slots ?? []).map((slot) => slot.toISOString()),
      };
    },
  );

  /** Жилец отменяет выбранное время: окна остаются, выбор начинается заново. */
  scope.delete<{ Params: { id: string } }>(
    '/api/requests/:id/visit',
    { schema: { params: idParamsSchema, response: { 200: visitSchema } } },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const updated = await dropVisitSlot(deps, resident, request.params.id);

      return {
        requestId: updated.id,
        slots: (updated.appointment?.slots ?? []).map((slot) => slot.toISOString()),
      };
    },
  );

  /** Мастер приехал и не попал в квартиру: срок двигается, жилец выбирает заново. */
  scope.post<{ Params: { id: string }; Body: { comment?: string } }>(
    '/api/requests/:id/visit/missed',
    {
      schema: {
        params: idParamsSchema,
        body: { type: 'object', properties: { comment: { type: 'string' } } },
        response: { 200: visitSchema },
      },
    },
    async (request) => {
      const staff = await currentResident(request.max.userId);
      const updated = await missedVisit(deps, {
        staff,
        requestId: request.params.id,
        ...(request.body.comment ? { comment: request.body.comment } : {}),
      });

      return { requestId: updated.id, slots: [] };
    },
  );

  /** Заявитель не согласен с отказом: заявка возвращается на пересмотр. */
  scope.post<{ Params: { id: string }; Body: { comment: string } }>(
    '/api/requests/:id/dispute',
    {
      schema: {
        params: idParamsSchema,
        body: { type: 'object', required: ['comment'], properties: { comment: { type: 'string' } } },
        response: {
          200: {
            type: 'object',
            required: ['requestId', 'status'],
            properties: { requestId: { type: 'string' }, status: { type: 'string' } },
          },
        },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const updated = await disputeRequest(deps, {
        resident,
        requestId: request.params.id,
        comment: request.body.comment,
      });

      return { requestId: updated.id, status: updated.status };
    },
  );

  /** День исполнителя: наряды по порядку обхода. */
  scope.get(
    '/api/workday',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['items', 'appointed', 'overdue'],
            properties: {
              appointed: { type: 'number' },
              overdue: { type: 'number' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['requestId', 'number', 'title', 'place', 'status', 'dueAt', 'overdue'],
                  properties: {
                    requestId: { type: 'string' },
                    number: { type: 'string' },
                    title: { type: 'string' },
                    place: { type: 'string' },
                    entrance: { type: 'number' },
                    status: { type: 'string' },
                    priority: { type: 'string' },
                    visitAt: { type: 'string' },
                    dueAt: { type: 'string' },
                    overdue: { type: 'boolean' },
                    materials: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['title', 'count'],
                        properties: {
                          title: { type: 'string' },
                          count: { type: 'number' },
                          unit: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const staff = await currentResident(request.max.userId);
      const day = await workdayFor(deps, staff);

      return {
        appointed: day.appointed,
        overdue: day.overdue,
        items: day.items.map((item) => ({
          ...item,
          ...(item.visitAt ? { visitAt: item.visitAt.toISOString() } : {}),
          dueAt: item.dueAt.toISOString(),
        })),
      };
    },
  );
};
