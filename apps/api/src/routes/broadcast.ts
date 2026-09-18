import { aimBroadcast, broadcastTargets, sendBroadcast } from '@domovoy/app';
import {
  BROADCAST_FLATS_LIMIT,
  BROADCAST_KINDS,
  BROADCAST_MAX_LENGTH,
  DomainError,
  type BroadcastKind,
  type BroadcastScope,
} from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';

import { residentReader, type RoutesDeps } from '../context.js';
import { buildingQuerySchema } from '../serialize.js';

/** Адресат приходит плоским телом: так его проще проверить схемой. */
interface ScopeBody {
  kind: BroadcastKind;
  entrance?: number;
  riser?: number;
  numbers?: number[];
  pollId?: string;
}

const scopeSchema = {
  kind: { type: 'string', enum: BROADCAST_KINDS },
  entrance: { type: 'integer', minimum: 1 },
  riser: { type: 'integer', minimum: 1 },
  numbers: {
    type: 'array',
    maxItems: BROADCAST_FLATS_LIMIT,
    items: { type: 'integer', minimum: 1 },
  },
  pollId: { type: 'string', maxLength: 128 },
};

const aimSchema = {
  type: 'object',
  properties: {
    audience: { type: 'string' },
    people: { type: 'integer' },
    recipients: { type: 'integer' },
    apartments: { type: 'integer' },
  },
};

/** Адресат из тела запроса. @throws {DomainError} */
const scopeFrom = (body: ScopeBody): BroadcastScope => {
  switch (body.kind) {
    case 'entrance':
      if (body.entrance === undefined) throw new DomainError('target_required', 'Не выбран подъезд');

      return { kind: 'entrance', entrance: body.entrance };
    case 'riser':
      if (body.entrance === undefined || body.riser === undefined) {
        throw new DomainError('target_required', 'Не выбраны подъезд и стояк');
      }

      return { kind: 'riser', entrance: body.entrance, riser: body.riser };
    case 'apartments':
      if (!body.numbers || body.numbers.length === 0) {
        throw new DomainError('target_required', 'Не выбраны квартиры');
      }

      return { kind: 'apartments', numbers: body.numbers };
    case 'poll':
      if (!body.pollId) throw new DomainError('target_required', 'Не выбрано собрание');

      return { kind: 'poll', pollId: body.pollId };
    default:
      return { kind: body.kind };
  }
};

/** Рассылка управляющей компании по личным перепискам. */
export const broadcastRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  /** Из чего собирается адресат: подъезды, стояки и открытые собрания. */
  scope.get<{ Querystring: { buildingId?: string } }>(
    '/api/broadcast/targets',
    {
      schema: {
        querystring: buildingQuerySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              flats: { type: 'integer' },
              staff: { type: 'integer' },
              entrances: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    entrance: { type: 'integer' },
                    flats: { type: 'integer' },
                    risers: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { riser: { type: 'integer' }, flats: { type: 'integer' } },
                      },
                    },
                  },
                },
              },
              polls: {
                type: 'array',
                items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
    async (request) =>
      broadcastTargets(deps, await currentResident(request.max.userId, request.query.buildingId), request.query.buildingId),
  );

  /** Сколько человек получит сообщение: показывается до отправки. */
  scope.post<{ Querystring: { buildingId?: string }; Body: ScopeBody }>(
    '/api/broadcast/preview',
    {
      schema: {
        querystring: buildingQuerySchema,
        body: { type: 'object', required: ['kind'], additionalProperties: false, properties: scopeSchema },
        response: { 200: aimSchema },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);
      const aim = await aimBroadcast(deps, resident, scopeFrom(request.body), request.query.buildingId);

      return {
        audience: aim.description,
        people: aim.people,
        recipients: aim.recipients,
        apartments: aim.apartments,
      };
    },
  );

  scope.post<{ Querystring: { buildingId?: string }; Body: ScopeBody & { text: string } }>(
    '/api/broadcast',
    {
      schema: {
        querystring: buildingQuerySchema,
        body: {
          type: 'object',
          required: ['kind', 'text'],
          additionalProperties: false,
          properties: { ...scopeSchema, text: { type: 'string', minLength: 1, maxLength: BROADCAST_MAX_LENGTH } },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              audience: { type: 'string' },
              people: { type: 'integer' },
              recipients: { type: 'integer' },
              apartments: { type: 'integer' },
              sent: { type: 'integer' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);

      const result = await sendBroadcast(deps, {
        actor: resident,
        scope: scopeFrom(request.body),
        text: request.body.text,
        ...(request.query.buildingId ? { buildingId: request.query.buildingId } : {}),
      });

      return reply.code(201).send({
        audience: result.description,
        people: result.people,
        recipients: result.recipients,
        apartments: result.apartments,
        sent: result.sent,
      });
    },
  );
};
