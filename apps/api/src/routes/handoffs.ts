import {
  answerHandoff,
  clarifyTarget,
  getRequestFor,
  handoffsOf,
  passRequest,
  responsibilityOf,
  retargetRequest,
  waitingHandoffs,
} from '@domovoy/app';
import { type HandoffStatus, type HandoffTarget } from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';

import { requestNotFound } from '../errors.js';
import {
  buildingQuerySchema,
  HANDOFF_TARGETS,
  handoffSchema,
  idParamsSchema,
  requestSchema,
  requestView,
  responsibilitySchema,
  serializeHandoff,
} from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Сколько знаков помещается в ответ смежной организации. */
const ANSWER_MAX_LENGTH = 2000;

/**
 * Передача обращения смежной организации: ресурсникам, подрядчику,
 * муниципальной службе или надзору. Кому передано, в какой срок ждать ответ
 * и на каком основании, видит и смена, и сам жилец.
 */
export const handoffRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  /** Кто отвечает за заявку и кому её можно передать. */
  scope.get<{ Params: { id: string } }>(
    '/api/requests/:id/responsibility',
    {
      schema: { params: idParamsSchema, response: { 200: responsibilitySchema } },
    },
    async (request, reply) => {
      const resident = await currentResident(request.max.userId);
      const found = await getRequestFor(deps, resident, request.params.id);

      if (!found) throw requestNotFound();

      const view = await responsibilityOf(deps, found);
      const now = deps.now();

      const staff = resident.role !== 'resident';

      return reply.send({
        ...view.responsibility,
        // Жильцу идёт короткая строка: номер статьи ему ничего не решает.
        basis: staff ? view.responsibility.basis : view.responsibility.plain,
        ...(staff ? {} : { next: undefined }),
        ...(view.organization ? { organization: view.organization } : {}),
        // Передаёт только смена: жильцу список адресатов ни к чему.
        targets: staff ? view.targets : [],
        handoffs: (await handoffsOf(deps, found.id, resident)).map((handoff) =>
          serializeHandoff(handoff, now, staff),
        ),
      });
    },
  );

  /** Передача обращения смежной организации. */
  scope.post<{ Params: { id: string }; Body: { to: HandoffTarget; note?: string } }>(
    '/api/requests/:id/handoff',
    {
      schema: {
        params: idParamsSchema,
        body: {
          type: 'object',
          required: ['to'],
          additionalProperties: false,
          properties: {
            to: { type: 'string', enum: HANDOFF_TARGETS },
            note: { type: 'string', maxLength: ANSWER_MAX_LENGTH },
          },
        },
        response: { 200: handoffSchema },
      },
    },
    async (request, reply) => {
      const staff = await currentResident(request.max.userId);

      const handoff = await passRequest(deps, {
        staff,
        requestId: request.params.id,
        to: request.body.to,
        ...(request.body.note ? { note: request.body.note } : {}),
      });

      return reply.send(serializeHandoff(handoff, deps.now()));
    },
  );

  /** Ответ принимающей стороны: его записывает смена. */
  scope.post<{ Params: { id: string }; Body: { status?: string; answer?: string; externalId?: string } }>(
    '/api/handoffs/:id/answer',
    {
      schema: {
        params: idParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['sent', 'accepted', 'answered', 'failed'] },
            answer: { type: 'string', maxLength: ANSWER_MAX_LENGTH },
            externalId: { type: 'string', maxLength: 128 },
          },
        },
        response: { 200: handoffSchema },
      },
    },
    async (request, reply) => {
      const staff = await currentResident(request.max.userId);

      const handoff = await answerHandoff(deps, {
        handoffId: request.params.id,
        status: (request.body.status as HandoffStatus | undefined) ?? 'answered',
        staff,
        ...(request.body.answer ? { answer: request.body.answer } : {}),
        ...(request.body.externalId ? { externalId: request.body.externalId } : {}),
      });

      return reply.send(serializeHandoff(handoff, deps.now()));
    },
  );

  /** Уточняющий вопрос об адресе заявки: вопрос и готовые варианты. */
  scope.get<{ Params: { id: string } }>(
    '/api/requests/:id/clarify',
    {
      schema: {
        params: idParamsSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              anyApartment: { type: 'boolean' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['label', 'startParam'],
                  properties: { label: { type: 'string' }, startParam: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const resident = await currentResident(request.max.userId);
      const found = await getRequestFor(deps, resident, request.params.id);

      if (!found) throw requestNotFound();

      return reply.send((await clarifyTarget(deps, resident, found)) ?? {});
    },
  );

  /** Ответ на уточняющий вопрос: адрес заявки становится точным. */
  scope.post<{ Params: { id: string }; Body: { startParam: string } }>(
    '/api/requests/:id/target',
    {
      schema: {
        params: idParamsSchema,
        body: {
          type: 'object',
          required: ['startParam'],
          additionalProperties: false,
          properties: { startParam: { type: 'string', minLength: 1, maxLength: 512 } },
        },
        response: { 200: requestSchema },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId);

      const updated = await retargetRequest(deps, {
        resident,
        requestId: request.params.id,
        startParam: request.body.startParam,
      });

      return requestView(deps, updated, resident);
    },
  );

  /** Переданные обращения дома, по которым ответа ещё нет. */
  scope.get<{ Querystring: { buildingId?: string } }>(
    '/api/handoffs',
    {
      schema: { querystring: buildingQuerySchema, response: { 200: { type: 'array', items: handoffSchema } } },
    },
    async (request) => {
      const staff = await currentResident(request.max.userId, request.query.buildingId);
      const now = deps.now();

      return (await waitingHandoffs(deps, staff, request.query.buildingId)).map((handoff) =>
        serializeHandoff(handoff, now),
      );
    },
  );
};
