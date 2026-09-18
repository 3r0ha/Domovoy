import { handOverBuilding } from '@domovoy/app';
import type { FastifyPluginAsync } from 'fastify';

import { buildingQuerySchema } from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Смена управляющей организации: дом переходит вместе с чатом и историей. */
export const handoverRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  /**
   * Передача дома другой управляющей организации. Дом, его чат, заявки
   * и показания остаются на месте, меняются организация и её люди.
   */
  scope.post<{
    Querystring: { buildingId?: string };
    Body: { company: string; managerId: string; confirm: boolean; current?: string };
  }>(
    '/api/buildings/handover',
    {
      schema: {
        querystring: buildingQuerySchema,
        body: {
          type: 'object',
          required: ['company', 'managerId', 'confirm'],
          additionalProperties: false,
          properties: {
            company: { type: 'string', minLength: 1, maxLength: 200 },
            managerId: { type: 'string', minLength: 1, maxLength: 128 },
            // Согласие на передачу: случайным повторным запросом дом не уходит.
            confirm: { type: 'boolean', enum: [true] },
            // Название организации, которая ведёт дом сейчас: им подтверждают, что передают этот дом.
            current: { type: 'string', maxLength: 200 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['buildingId', 'company', 'managerName', 'released', 'notified', 'chatKept'],
            properties: {
              buildingId: { type: 'string' },
              company: { type: 'string' },
              managerName: { type: 'string' },
              released: { type: 'integer' },
              notified: { type: 'integer' },
              chatKept: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request) => {
      const manager = await currentResident(request.max.userId, request.query.buildingId);
      const buildingId = request.query.buildingId ?? manager.buildingId ?? deps.defaultBuildingId;

      const result = await handOverBuilding(deps, {
        manager,
        buildingId,
        company: request.body.company,
        managerId: request.body.managerId,
        current: request.body.current ?? '',
      });

      return {
        buildingId: result.buildingId,
        company: result.company,
        managerName: result.manager.displayName,
        released: result.released,
        notified: result.notified,
        chatKept: result.chatKept,
      };
    },
  );
};
