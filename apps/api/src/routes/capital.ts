import { DomainError } from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';

import { ServiceError } from '../errors.js';
import { buildingQuerySchema } from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Капитальный ремонт дома: сведения региональной программы. */
export const capitalRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  /**
   * Капитальный ремонт дома: его ведёт региональная программа, а не
   * управляющая организация. Без подключения раздела нет вовсе.
   */
  scope.get<{ Querystring: { buildingId?: string } }>(
    '/api/capital-repair',
    {
      schema: {
        querystring: buildingQuerySchema,
        response: {
          200: {
            type: 'object',
            required: ['works'],
            properties: {
              source: { type: 'string' },
              model: { type: 'boolean' },
              fund: { type: 'string' },
              contribution: { type: 'number' },
              balance: { type: 'number' },
              operator: { type: 'string' },
              works: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['title', 'year', 'state'],
                  properties: {
                    title: { type: 'string' },
                    year: { type: 'integer' },
                    state: { type: 'string' },
                    note: { type: 'string' },
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
      const buildingId = request.query.buildingId ?? resident.buildingId ?? deps.defaultBuildingId;
      const building = await deps.repository.findBuilding(buildingId);

      if (!building) throw new DomainError('building_not_found', 'Дом не найден');

      const directory = deps.capitalRepair;

      // Раздела нет вовсе: сведения ведёт региональная программа, а не продукт.
      if (!directory) return { works: [] };

      // Отказ источника от «дома нет в программе» отличается ответом, а не пустотой.
      const plan = await directory.planFor(buildingId, building).catch(() => {
        throw new ServiceError('capital_unavailable', 'Региональная программа капитального ремонта не отвечает');
      });

      if (!plan) return { works: [] };

      return {
        ...plan,
        source: directory.title,
        ...(directory.model ? { model: true } : {}),
        // Сортируется копия: список принадлежит источнику, а не ответу.
        works: [...plan.works].sort((left, right) => left.year - right.year),
      };
    },
  );
};
