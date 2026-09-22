import { askToConnect, declareOwnership, dropNeighbour, flatNeighbours, ownConnectionRequest, setOwnership } from '@domovoy/app';
import type { FastifyPluginAsync } from 'fastify';

import { residentReader, type RoutesDeps } from '../context.js';

/**
 * Кто живёт в квартире и кто ею владеет. Код из квитанции лежит в почтовом
 * ящике, поэтому жилец видит всех привязанных и убирает чужого сам, а право
 * собственности решает, есть ли у него голос на собрании.
 */
export const ownershipRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  const neighboursSchema = {
    type: 'array',
    items: {
      type: 'object',
      required: ['id', 'displayName', 'owner', 'self'],
      properties: {
        id: { type: 'string' },
        displayName: { type: 'string' },
        owner: { type: 'boolean' },
        self: { type: 'boolean' },
      },
    },
  } as const;

  scope.get('/api/flat/neighbours', { schema: { response: { 200: neighboursSchema } } }, async (request) => {
    const resident = await currentResident(request.max.userId);

    return flatNeighbours(deps, resident);
  });

  scope.delete<{ Params: { id: string } }>(
    '/api/flat/neighbours/:id',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: neighboursSchema },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId);

      return dropNeighbour(deps, resident, request.params.id);
    },
  );

  /** Слова самого жильца: собственник он или живёт на других основаниях. */
  scope.post<{ Body: { owner: boolean } }>(
    '/api/flat/ownership',
    {
      schema: {
        body: { type: 'object', required: ['owner'], properties: { owner: { type: 'boolean' } } },
        response: {
          200: {
            type: 'object',
            required: ['owner'],
            properties: { owner: { type: 'boolean' } },
          },
        },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const saved = await declareOwnership(deps, resident, request.body.owner);

      return { owner: (saved.owned ?? []).length > 0 };
    },
  );

  /** Подтверждение права собственности управляющей организацией. */
  scope.post<{ Body: { residentId: string; apartmentId: string; share: number | null } }>(
    '/api/staff/ownership',
    {
      schema: {
        body: {
          type: 'object',
          required: ['residentId', 'apartmentId'],
          properties: {
            residentId: { type: 'string' },
            apartmentId: { type: 'string' },
            share: { type: ['number', 'null'] },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['residentId', 'owner'],
            properties: { residentId: { type: 'string' }, owner: { type: 'boolean' } },
          },
        },
      },
    },
    async (request) => {
      const staff = await currentResident(request.max.userId);
      const saved = await setOwnership(deps, staff, {
        residentId: request.body.residentId,
        apartmentId: request.body.apartmentId,
        share: request.body.share ?? null,
      });

      return { residentId: saved.id, owner: (saved.owned ?? []).length > 0 };
    },
  );

  const connectionSchema = {
    type: 'object',
    properties: {
      address: { type: 'string' },
      company: { type: 'string' },
      at: { type: 'string' },
    },
  } as const;

  /** Дом, которого в продукте ещё нет: человек оставляет адрес. */
  scope.get('/api/connect', { schema: { response: { 200: connectionSchema } } }, async (request) => {
    const resident = await currentResident(request.max.userId);
    const asked = await ownConnectionRequest(deps, resident);

    return asked ? { address: asked.address, ...(asked.company ? { company: asked.company } : {}), at: asked.at.toISOString() } : {};
  });

  scope.post<{ Body: { address: string; company?: string; phone?: string } }>(
    '/api/connect',
    {
      schema: {
        body: {
          type: 'object',
          required: ['address'],
          properties: {
            address: { type: 'string' },
            company: { type: 'string' },
            phone: { type: 'string' },
          },
        },
        response: { 200: connectionSchema },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const saved = await askToConnect(deps, {
        resident,
        address: request.body.address,
        ...(request.body.company ? { company: request.body.company } : {}),
        ...(request.body.phone ? { phone: request.body.phone } : {}),
      });

      return {
        address: saved.address,
        ...(saved.company ? { company: saved.company } : {}),
        at: saved.at.toISOString(),
      };
    },
  );
};
