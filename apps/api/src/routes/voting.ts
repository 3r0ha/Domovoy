import {
  BOM,
  listPollsFor,
  startElderPoll,
  listInitiativesFor,
  callMeeting,
  startInitiative,
  supportInitiative,
  pollProtocol,
  speak,
  startPoll,
  translateForReading,
  vote,
} from '@domovoy/app';
import type { FastifyPluginAsync } from 'fastify';
import { DomainError } from '@domovoy/domain';
import {
  asAttachment,
  buildingQuerySchema,
  emptyResult,
  idParamsSchema,
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
          querystring: buildingQuerySchema,
          response: { 200: { type: 'array', items: pollSchema } },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const polls = await listPollsFor(deps, resident);
        const t = speak(resident);
        // Название и вопрос собрания пишет один человек, а голосует весь дом.
        const machine = await translateForReading(
          deps,
          resident,
          polls.flatMap((view) => [view.poll.title, view.poll.question]),
        );

        return polls.map((view) => serializePoll(view, t, machine));
      },
    );

    scope.post<{
      Querystring: { buildingId?: string };
      Body: {
        kind: 'simple' | 'qualified';
        title: string;
        question: string;
        days: number;
        mode?: 'meeting' | 'survey';
      };
    }>(
      '/api/polls',
      {
        schema: {
          querystring: buildingQuerySchema,
          body: {
            type: 'object',
            required: ['kind', 'title', 'question', 'days'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['simple', 'qualified'] },
              title: { type: 'string', minLength: 1, maxLength: 200 },
              question: { type: 'string', minLength: 1, maxLength: 2000 },
              days: { type: 'integer', minimum: 1, maximum: 60 },
              mode: { type: 'string', enum: ['meeting', 'survey'] },
            },
          },
          response: { 201: pollSchema },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        // Поля перечислены поимённо: тело запроса собрание от чужого имени не объявляет.
        const poll = await startPoll(deps, {
          resident,
          kind: request.body.kind,
          title: request.body.title,
          question: request.body.question,
          days: request.body.days,
          ...(request.body.mode ? { mode: request.body.mode } : {}),
        });
        const view = (await listPollsFor(deps, resident)).find((item) => item.poll.id === poll.id);

        return reply
          .code(201)
          .send(serializePoll(view ?? { poll, result: emptyResult, open: true, areaToQuorum: 0 }, speak(resident)));
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
          querystring: buildingQuerySchema,
          body: {
            type: 'object',
            required: ['candidateId', 'days'],
            additionalProperties: false,
            properties: {
              candidateId: { type: 'string', minLength: 1, maxLength: 128 },
              days: { type: 'integer', minimum: 1, maximum: 90 },
            },
          },
          response: { 201: pollSchema },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        const poll = await startElderPoll(deps, {
          resident,
          candidateId: request.body.candidateId,
          days: request.body.days,
        });
        const views = await listPollsFor(deps, resident);
        const view = views.find((item) => item.poll.id === poll.id);

        return reply
          .code(201)
          .send(serializePoll(view ?? { poll, result: emptyResult, open: true, areaToQuorum: 0 }, speak(resident)));
      },
    );

    /** Предложения жильцов, которые собирают подписи соседей. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/initiatives',
      {
        schema: {
          querystring: buildingQuerySchema,
          response: { 200: { type: 'array', items: initiativeSchema } },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        const t = speak(resident);
        const found = await listInitiativesFor(deps, resident);
        const machine = await translateForReading(
          deps,
          resident,
          found.flatMap((view) => [view.initiative.title, view.initiative.question]),
        );

        return found.map((view) => serializeInitiative(view, t, machine));
      },
    );

    scope.post<{
      Querystring: { buildingId?: string };
      Body: { kind?: 'simple' | 'qualified'; title: string; question: string };
    }>(
      '/api/initiatives',
      {
        schema: {
          querystring: buildingQuerySchema,
          body: {
            type: 'object',
            required: ['title', 'question'],
            additionalProperties: false,
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

        const initiative = await startInitiative(deps, {
          resident,
          title: request.body.title,
          question: request.body.question,
          ...(request.body.kind ? { kind: request.body.kind } : {}),
        });
        const views = await listInitiativesFor(deps, resident);
        const view = views.find((item) => item.initiative.id === initiative.id);

        if (!view) throw new DomainError('initiative_not_found', 'Предложение не найдено');

        return reply.code(201).send(serializeInitiative(view, speak(resident)));
      },
    );

    /** «Я тоже за»: подпись соседа под предложением. */
    scope.post<{ Params: { id: string } }>(
      '/api/initiatives/:id/support',
      { schema: { params: idParamsSchema, response: { 200: initiativeSchema } } },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        return serializeInitiative(
          await supportInitiative(deps, { resident, initiativeId: request.params.id }),
          speak(resident),
        );
      },
    );

    /** Созыв собрания по инициативе: подписи собраны, вопрос выносят на голосование. */
    scope.post<{ Params: { id: string }; Body: { days: number; kind?: 'simple' | 'qualified' } }>(
      '/api/initiatives/:id/meeting',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['days'],
            additionalProperties: false,
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
          .send(serializePoll(view ?? { poll, result: emptyResult, open: true, areaToQuorum: 0 }, speak(resident)));
      },
    );

    scope.post<{ Params: { id: string }; Body: { choice: 'for' | 'against' | 'abstain' } }>(
      '/api/polls/:id/vote',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['choice'],
            additionalProperties: false,
            properties: { choice: { type: 'string', enum: ['for', 'against', 'abstain'] } },
          },
          response: { 200: pollSchema },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        return serializePoll(
          await vote(deps, { resident, pollId: request.params.id, choice: request.body.choice }),
          speak(resident),
        );
      },
    );

    scope.get<{ Params: { id: string } }>(
      '/api/polls/:id/protocol',
      {
        schema: {
          params: idParamsSchema,
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
    scope.get<{ Params: { id: string } }>(
      '/api/polls/:id/protocol.txt',
      { schema: { params: idParamsSchema } },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);

        const text = await pollProtocol(deps, resident, request.params.id);
        const name = `протокол-${request.params.id}.txt`;

        return asAttachment(reply, name, 'text/plain; charset=utf-8').send(`${BOM}${text}\n`);
      },
    );

};
