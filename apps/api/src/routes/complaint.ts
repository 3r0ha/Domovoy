import { escalationFor, sendComplaint } from '@domovoy/app';
import type { FastifyPluginAsync } from 'fastify';

import { idParamsSchema } from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/**
 * Обращение в жилищную инспекцию по нарушенному сроку: продукт собирает текст
 * и отправляет его каналом надзора, но только после согласия человека.
 */
export const complaintRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  scope.get<{ Params: { id: string } }>(
    '/api/requests/:id/complaint',
    {
      schema: {
        params: idParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['possible', 'reason'],
            properties: {
              possible: { type: 'boolean' },
              reason: { type: 'string' },
              complaint: { type: 'string' },
              sent: {
                type: 'object',
                properties: {
                  externalId: { type: 'string' },
                  dueAt: { type: 'string' },
                  organization: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const offer = await escalationFor(deps, resident, request.params.id);

      return {
        ...offer,
        ...(offer.sent ? { sent: { ...offer.sent, dueAt: offer.sent.dueAt.toISOString() } } : {}),
      };
    },
  );

  /**
   * Отправка обращения в надзор. Кнопка «пожаловаться» текст только готовит,
   * отправку человек подтверждает отдельно: это письмо в орган власти.
   */
  scope.post<{ Params: { id: string } }>(
    '/api/requests/:id/complaint',
    {
      schema: {
        params: idParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['organization', 'dueAt'],
            properties: {
              organization: { type: 'string' },
              externalId: { type: 'string' },
              dueAt: { type: 'string' },
              model: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const { handoff } = await sendComplaint(deps, resident, request.params.id);

      return {
        organization: handoff.organization,
        ...(handoff.externalId ? { externalId: handoff.externalId } : {}),
        dueAt: handoff.dueAt.toISOString(),
        ...(deps.handoffs?.model ? { model: true } : {}),
      };
    },
  );
};
