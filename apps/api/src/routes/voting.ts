import {
  BOM,
  listPollsFor,
  startElderPoll,
  listInitiativesFor,
  callMeeting,
  startInitiative,
  supportInitiative,
  pollProtocol,
  startPoll,
  vote,
} from '@domovoy/app';
import type { FastifyPluginAsync } from 'fastify';
import {
  buildingIdSchema,
  emptyResult,
  initiativeSchema,
  pollSchema,
  serializeInitiative,
  serializePoll,
} from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Собрания собственников и предложения жильцов. */
export const votingRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

    /** Собрания собственников с текущими долями. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/polls',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: { 200: { type: 'array', items: pollSchema } },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const polls = await listPollsFor(deps, resident);

        return polls.map(serializePoll);
      },
    );

    scope.post<{
      Querystring: { buildingId?: string };
      Body: { kind: 'simple' | 'qualified'; title: string; question: string; days: number };
    }>(
      '/api/polls',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          body: {
            type: 'object',
            required: ['kind', 'title', 'question', 'days'],
            properties: {
              kind: { type: 'string', enum: ['simple', 'qualified'] },
              title: { type: 'string', minLength: 1, maxLength: 200 },
              question: { type: 'string', minLength: 1, maxLength: 2000 },
              days: { type: 'integer', minimum: 1, maximum: 90 },
            },
          },
          response: { 201: pollSchema },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const poll = await startPoll(deps, { resident, ...request.body });
        const view = (await listPollsFor(deps, resident)).find((item) => item.poll.id === poll.id);

        return reply.code(201).send(serializePoll(view ?? { poll, result: emptyResult, open: true, areaToQuorum: 0 }));
      },
    );

    /** Выборы старшего по подъезду: то же собрание, только с кандидатом. */
    scope.post<{
      Querystring: { buildingId?: string };
      Body: { candidateId: string; days: number };
    }>(
      '/api/polls/elder',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          body: {
            type: 'object',
            required: ['candidateId', 'days'],
            properties: {
              candidateId: { type: 'string', maxLength: 128 },
              days: { type: 'integer', minimum: 1, maximum: 90 },
            },
          },
          response: { 201: pollSchema },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const poll = await startElderPoll(deps, { resident, ...request.body });
        const views = await listPollsFor(deps, resident);
        const view = views.find((item) => item.poll.id === poll.id);

        return reply
          .code(201)
          .send(serializePoll(view ?? { poll, result: emptyResult, open: true, areaToQuorum: 0 }));
      },
    );

    /** Предложения жильцов, которые собирают подписи соседей. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/initiatives',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: { 200: { type: 'array', items: initiativeSchema } },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        return (await listInitiativesFor(deps, resident)).map(serializeInitiative);
      },
    );

    scope.post<{
      Querystring: { buildingId?: string };
      Body: { kind?: 'simple' | 'qualified'; title: string; question: string };
    }>(
      '/api/initiatives',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          body: {
            type: 'object',
            required: ['title', 'question'],
            properties: {
              kind: { type: 'string', enum: ['simple', 'qualified'] },
              title: { type: 'string', minLength: 1, maxLength: 200 },
              question: { type: 'string', minLength: 1, maxLength: 2000 },
            },
          },
          response: { 201: initiativeSchema },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const initiative = await startInitiative(deps, { resident, ...request.body });
        const views = await listInitiativesFor(deps, resident);
        const view = views.find((item) => item.initiative.id === initiative.id);

        return reply.code(201).send(view ? serializeInitiative(view) : undefined);
      },
    );

    /** «Я тоже за»: подпись соседа под предложением. */
    scope.post<{ Params: { id: string } }>(
      '/api/initiatives/:id/support',
      { schema: { response: { 200: initiativeSchema } } },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        return serializeInitiative(await supportInitiative(deps, { resident, initiativeId: request.params.id }));
      },
    );

    /** Созыв собрания по инициативе: подписи собраны, вопрос выносят на голосование. */
    scope.post<{ Params: { id: string }; Body: { days: number; kind?: 'simple' | 'qualified' } }>(
      '/api/initiatives/:id/meeting',
      {
        schema: {
          body: {
            type: 'object',
            required: ['days'],
            properties: {
              days: { type: 'integer', minimum: 1, maximum: 90 },
              kind: { type: 'string', enum: ['simple', 'qualified'] },
            },
          },
          response: { 201: pollSchema },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);
        const poll = await callMeeting(deps, {
          resident,
          initiativeId: request.params.id,
          days: request.body.days,
          ...(request.body.kind ? { kind: request.body.kind } : {}),
        });
        const views = await listPollsFor(deps, resident);
        const view = views.find((item) => item.poll.id === poll.id);

        return reply
          .code(201)
          .send(serializePoll(view ?? { poll, result: emptyResult, open: true, areaToQuorum: 0 }));
      },
    );

    scope.post<{ Params: { id: string }; Body: { choice: 'for' | 'against' | 'abstain' } }>(
      '/api/polls/:id/vote',
      {
        schema: {
          body: {
            type: 'object',
            required: ['choice'],
            properties: { choice: { type: 'string', enum: ['for', 'against', 'abstain'] } },
          },
          response: { 200: pollSchema },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        return serializePoll(await vote(deps, { resident, pollId: request.params.id, choice: request.body.choice }));
      },
    );

    scope.get<{ Params: { id: string } }>(
      '/api/polls/:id/protocol',
      {
        schema: {
          response: {
            200: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        return { text: await pollProtocol(deps, resident, request.params.id) };
      },
    );

    /** Тот же протокол файлом. */
    scope.get<{ Params: { id: string } }>('/api/polls/:id/protocol.txt', async (request, reply) => {
      const resident = await currentResident(request.max.userId);

      const text = await pollProtocol(deps, resident, request.params.id);
      const name = `протокол-${request.params.id}.txt`;

      return reply
        .type('text/plain; charset=utf-8')
        .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
        .send(`${BOM}${text}\n`);
    });

};
