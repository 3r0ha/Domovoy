import {
  answerSupport,
  askSupport,
  closeSupport,
  describeTickets,
  listSupportFor,
  supportTicket,
  type Resident,
} from '@domovoy/app';
import { DomainError, isCompanyStaff, MESSAGE_MAX_LENGTH, type Attachment, type SupportTicket } from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';

import {
  attachmentsBodySchema,
  buildingQuerySchema,
  idParamsSchema,
  serializeTicket,
  ticketSchema,
} from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Поддержка: вопрос жильца управляющей компании и ответ смены. */
export const supportRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  /** Одно обращение с тем же, что видно в списке: кто спросил и сколько ждёт. */
  const one = async (ticket: SupportTicket, viewer: Resident) => {
    const [card] = await describeTickets(deps, [ticket]);

    // Схема ответа обязывает вернуть обращение: пустое тело с кодом 200 клиенту не ответ.
    if (!card) throw new DomainError('ticket_not_found', 'Обращение не найдено');

    return serializeTicket(card, viewer.id, isCompanyStaff(viewer.role));
  };

  /** Свои обращения, а у смены, вопросы всего дома. */
  scope.get<{ Querystring: { buildingId?: string } }>(
    '/api/support',
    {
      schema: {
        querystring: buildingQuerySchema,
        response: { 200: { type: 'array', items: ticketSchema } },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);

      const cards = await describeTickets(deps, await listSupportFor(deps, resident));

      return cards.map((card) => serializeTicket(card, resident.id, isCompanyStaff(resident.role)));
    },
  );

  /** Новый вопрос или реплика в уже открытом обращении. */
  scope.post<{
    Querystring: { buildingId?: string };
    Body: { text: string; ticketId?: string; attachments?: Attachment[] };
  }>(
    '/api/support',
    {
      schema: {
        querystring: buildingQuerySchema,
        body: {
          type: 'object',
          required: ['text'],
          additionalProperties: false,
          properties: {
            text: { type: 'string', minLength: 1, maxLength: MESSAGE_MAX_LENGTH },
            ticketId: { type: 'string', minLength: 1, maxLength: 128 },
            attachments: attachmentsBodySchema,
          },
        },
        response: { 200: ticketSchema },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);

      const ticket = await askSupport(deps, {
        resident,
        text: request.body.text,
        ...(request.body.ticketId ? { ticketId: request.body.ticketId } : {}),
        ...(request.body.attachments?.length ? { attachments: request.body.attachments } : {}),
      });

      return one(ticket, resident);
    },
  );

  scope.get<{ Params: { id: string } }>(
    '/api/support/:id',
    { schema: { params: idParamsSchema, response: { 200: ticketSchema } } },
    async (request) => {
      const resident = await currentResident(request.max.userId);

      return one(await supportTicket(deps, resident, request.params.id), resident);
    },
  );

  /** Ответ смены жильцу. */
  scope.post<{
    Params: { id: string };
    Querystring: { buildingId?: string };
    Body: { text: string; attachments?: Attachment[] };
  }>(
    '/api/support/:id/answer',
    {
      schema: {
        params: idParamsSchema,
        querystring: buildingQuerySchema,
        body: {
          type: 'object',
          required: ['text'],
          additionalProperties: false,
          properties: {
            text: { type: 'string', minLength: 1, maxLength: MESSAGE_MAX_LENGTH },
            attachments: attachmentsBodySchema,
          },
        },
        response: { 200: ticketSchema },
      },
    },
    async (request) => {
      const staff = await currentResident(request.max.userId, request.query.buildingId);

      const ticket = await answerSupport(deps, {
        staff,
        ticketId: request.params.id,
        text: request.body.text,
        ...(request.body.attachments?.length ? { attachments: request.body.attachments } : {}),
      });

      return one(ticket, staff);
    },
  );

  /** Вопрос снят: закрывает тот, кто спросил, или смена. */
  scope.post<{ Params: { id: string } }>(
    '/api/support/:id/close',
    { schema: { params: idParamsSchema, response: { 200: ticketSchema } } },
    async (request) => {
      const resident = await currentResident(request.max.userId);
      const ticket = await closeSupport(deps, resident, request.params.id);

      return one(ticket, resident);
    },
  );

  /** Сколько вопросов ждёт ответа: значок раздела у смены. */
  scope.get<{ Querystring: { buildingId?: string } }>(
    '/api/support/waiting',
    {
      schema: {
        querystring: buildingQuerySchema,
        response: {
          200: { type: 'object', required: ['waiting'], properties: { waiting: { type: 'integer' } } },
        },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);
      const mine = await listSupportFor(deps, resident);

      return {
        waiting: mine.filter((ticket) =>
          isCompanyStaff(resident.role) ? ticket.status === 'open' : ticket.status === 'answered',
        ).length,
      };
    },
  );
};
