import {
  answerAlert,
  assessQueue,
  canAct,
  devicesAt,
  contactForRequest,
  supportRequest,
  supportableFor,
  getRequestFor,
  readFile,
  uploadFile,
  canKnockUpstairs,
  knockUpstairs,
  commentRequest,
  listRequestsFor,
  objectPassport,
  submitProblem,
  surveyOf,
  transitionRequest,
  CLOSED_PAGE,
  MAX_FILE_BYTES,
  type RequestScope,
} from '@domovoy/app';
import {
  decodeTarget,
  DomainError,
  MESSAGE_MAX_LENGTH,
  RATING_RANGE,
  allowedTransitions,
  hasReported,
  type RequestCategory,
  type RequestStatus,
  type ServiceRequest,
} from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';
import { requestNotFound } from '../errors.js';
import {
  asTitle,
  attachmentsBodySchema,
  buildingIdSchema,
  CATEGORIES,
  idParamsSchema,
  plannedSchema,
  requestSchema,
  requestView,
  serializeRequest,
  staffNames,
  startParamParamsSchema,
  STATUSES,
} from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Снимок в base64 весит на треть больше, и перед данными бывает заголовок data-URL. */
const FILE_BASE64_MAX = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 64;

/** Предел тела запроса со снимком: больше разрешённого файла читать незачем. */
const FILE_BODY_LIMIT = FILE_BASE64_MAX + 1024;

/** Обращение как его присылает клиент. */
interface SubmitBody {
  description: string;
  title?: string;
  category?: RequestCategory;
  startParam?: string;
  apartmentId?: string;
  /** Квартира не названа: обращение о доме, а не о квартире автора. */
  house?: boolean;
  attachments?: { kind: 'photo' | 'voice' | 'file'; token: string; transcript?: string }[];
  anyway?: boolean;
  /** Заявка, к которой обращение только что присоединили: «это другое» снимает участие в ней. */
  apartFrom?: string;
}

/** Что отвечает продукт на обращение: заявку, ответ про работы или ответ на вопрос. */
const submitted = async (
  deps: RoutesDeps,
  currentResident: ReturnType<typeof residentReader>,
  request: { max: { userId: number }; body: SubmitBody },
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
): Promise<unknown> => {
  const resident = await currentResident(request.max.userId);

  const result = await submitProblem(deps, {
    resident,
    description: request.body.description,
    ...(request.body.title ? { title: request.body.title } : {}),
    ...(request.body.category ? { category: request.body.category } : {}),
    ...(request.body.startParam ? { startParam: request.body.startParam } : {}),
    ...(request.body.apartmentId ? { apartmentId: request.body.apartmentId } : {}),
    ...(request.body.house ? { house: true } : {}),
    ...(request.body.attachments?.length ? { attachments: request.body.attachments } : {}),
    ...(request.body.anyway ? { anyway: true } : {}),
    ...(request.body.anyway && request.body.apartFrom ? { apartFrom: request.body.apartFrom } : {}),
  });

  if (result.kind === 'answered') {
    return reply.code(200).send({ joined: false, answered: result.answer });
  }

  if (result.kind === 'planned') {
    return reply.code(200).send({
      joined: false,
      planned: {
        title: result.work.title,
        category: result.work.category,
        until: result.work.until.toISOString(),
        message: result.explanation,
      },
    });
  }

  return reply.code(result.kind === 'joined' ? 200 : 201).send({
    joined: result.kind === 'joined',
    request: serializeRequest(result.request, deps.now(), undefined, resident),
    ...(result.question ? { question: result.question } : {}),
  });
};

/** Заявки: подача, переходы, переписка и вложения. */
export const requestRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

    /** Телефон автора заявки: при аварии мастеру нужно позвонить. */
    scope.get<{ Params: { id: string } }>(
      '/api/requests/:id/contact',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: {
              type: 'object',
              required: ['displayName'],
              properties: { displayName: { type: 'string' }, phone: { type: 'string' } },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        return contactForRequest(deps, resident, request.params.id);
      },
    );

    scope.get<{ Querystring: { scope?: RequestScope; buildingId?: string; before?: string; limit?: number } }>(
      '/api/requests',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['mine', 'queue', 'closed'] },
              buildingId: buildingIdSchema,
              before: { type: 'string', format: 'date-time' },
              limit: { type: 'integer', minimum: 1, maximum: 100 },
            },
          },
          response: { 200: { type: 'array', items: requestSchema } },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const scopeName = request.query.scope ?? 'mine';
        const found = await listRequestsFor(deps, resident, scopeName, {
          limit: request.query.limit ?? CLOSED_PAGE,
          ...(request.query.before ? { before: new Date(request.query.before) } : {}),
        });
        const moment = deps.now();
        const names = await staffNames(deps, found);

        if (resident.role === 'resident') {
          return found.map((item) => serializeRequest(item, moment, names, resident));
        }

        const assessed = await assessQueue(deps, found);

        return assessed.map((item) => ({
          ...serializeRequest(item.request, moment, names),
          risk: item.assessment.risk,
          riskReason: item.assessment.reason,
        }));
      },
    );

    scope.post<{ Body: SubmitBody }>(
      '/api/requests',
      {
        schema: {
          body: {
            type: 'object',
            required: ['description'],
            properties: {
              description: { type: 'string', minLength: 1, maxLength: 2000 },
              title: { type: 'string', maxLength: 120 },
              category: { type: 'string', enum: CATEGORIES },
              startParam: { type: 'string', minLength: 1, maxLength: 512 },
              apartmentId: { type: 'string', minLength: 1, maxLength: 128 },
              house: { type: 'boolean' },
              anyway: { type: 'boolean' },
              apartFrom: { type: 'string', minLength: 1, maxLength: 128 },
              attachments: attachmentsBodySchema,
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                joined: { type: 'boolean' },
                request: requestSchema,
                planned: plannedSchema,
                answered: { type: 'string' },
              },
            },
            201: {
              type: 'object',
              properties: { joined: { type: 'boolean' }, request: requestSchema, question: { type: 'string' } },
            },
          },
        },
      },
      (request, reply) => submitted(deps, currentResident, request, reply),
    );

    scope.get<{ Params: { startParam: string } }>(
      '/api/objects/:startParam',
      {
        schema: {
          params: startParamParamsSchema,
          response: {
            200: {
              type: 'object',
              required: ['startParam', 'target', 'open', 'history', 'totalRequests'],
              properties: {
                startParam: { type: 'string' },
                target: { type: 'string' },
                open: { type: 'array', items: requestSchema },
                history: { type: 'array', items: requestSchema },
                totalRequests: { type: 'integer' },
                devices: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      kind: { type: 'string' },
                      title: { type: 'string' },
                      entrance: { type: 'integer' },
                    },
                  },
                },
                lastRepairAt: { type: 'string' },
                averageDays: { type: 'integer' },
                dueInDays: { type: 'integer' },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);

        const passport = await objectPassport(deps, request.params.startParam, resident);

        if (!passport) throw new DomainError('code_not_found', 'Объект не найден');

        const moment = deps.now();
        const seen = (item: ServiceRequest) => ({
          ...serializeRequest(item, moment, undefined, resident),
          mine: hasReported(item, resident.id),
        });

        const decoded = decodeTarget(request.params.startParam);
        const devices = decoded ? await devicesAt(deps, resident.buildingId ?? '', decoded) : [];

        return reply.send({
          startParam: passport.startParam,
          target: asTitle(passport.target),
          open: passport.open.map(seen),
          history: passport.history.map(seen),
          totalRequests: passport.totalRequests,
          ...(devices.length > 0 ? { devices } : {}),
          ...(passport.lastRepairAt ? { lastRepairAt: passport.lastRepairAt.toISOString() } : {}),
          ...(passport.averageDays === undefined ? {} : { averageDays: passport.averageDays }),
          ...(passport.dueInDays === undefined ? {} : { dueInDays: passport.dueInDays }),
        });
      },
    );

    scope.get<{ Params: { id: string } }>(
      '/api/requests/:id',
      { schema: { params: idParamsSchema, response: { 200: requestSchema } } },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);
        const found = await getRequestFor(deps, resident, request.params.id);

        if (!found) throw requestNotFound();

        const survey = resident.role === 'resident' ? [] : await surveyOf(deps, found);

        return reply.send({
          ...serializeRequest(found, deps.now(), await staffNames(deps, [found]), resident),
          ...(survey.length > 0 ? { survey } : {}),
          ...((await canKnockUpstairs(deps, found)) ? { canKnock: true } : {}),
          mine: canAct(resident, found),
        });
      },
    );

    scope.post<{
      Params: { id: string };
      Body: {
        to: RequestStatus;
        comment?: string;
        assigneeId?: string;
        attachments?: { kind: 'photo' | 'voice' | 'file'; token: string; transcript?: string }[];
        rating?: number;
        provedBy?: string;
      };
    }>(
      '/api/requests/:id/transition',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['to'],
            properties: {
              to: { type: 'string', enum: STATUSES },
              comment: { type: 'string', maxLength: 2000 },
              assigneeId: { type: 'string' },
              attachments: attachmentsBodySchema,
              rating: { type: 'integer', minimum: RATING_RANGE.min, maximum: RATING_RANGE.max },
              provedBy: { type: 'string', maxLength: 512 },
            },
          },
          response: { 200: requestSchema },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);

        const updated = await transitionRequest(deps, {
          resident,
          requestId: request.params.id,
          to: request.body.to,
          ...(request.body.comment ? { comment: request.body.comment } : {}),
          ...(request.body.assigneeId ? { assigneeId: request.body.assigneeId } : {}),
          ...(request.body.attachments?.length ? { attachments: request.body.attachments } : {}),
          ...(request.body.rating === undefined ? {} : { rating: request.body.rating }),
          ...(request.body.provedBy ? { provedBy: request.body.provedBy } : {}),
        });

        return reply.send(await requestView(deps, updated, resident));
      },
    );

    /** Сообщение по заявке: состояние оно не меняет. */
    scope.post<{
      Params: { id: string };
      Body: { text: string; attachments?: { kind: 'photo' | 'voice' | 'file'; token: string; transcript?: string }[] };
    }>(
      '/api/requests/:id/comment',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['text'],
            properties: {
              text: { type: 'string', maxLength: MESSAGE_MAX_LENGTH },
              attachments: attachmentsBodySchema,
            },
          },
          response: { 200: requestSchema },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);

        const updated = await commentRequest(deps, {
          resident,
          requestId: request.params.id,
          text: request.body.text,
          ...(request.body.attachments?.length ? { attachments: request.body.attachments } : {}),
        });

        return reply.send(await requestView(deps, updated, resident));
      },
    );

    /** Ответ соседа на предупреждение об аварии. */
    scope.post<{ Params: { id: string }; Body: { affected: boolean } }>(
      '/api/requests/:id/answer',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['affected'],
            additionalProperties: false,
            properties: { affected: { type: 'boolean' } },
          },
          response: { 200: requestSchema },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);

        const { request: updated } = await answerAlert(deps, {
          resident,
          requestId: request.params.id,
          affected: request.body.affected,
        });

        return reply.send(await requestView(deps, updated, resident));
      },
    );

    /** Заявки дома, которые касаются жильца и заведены не им. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/requests/house',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: { 200: { type: 'array', items: requestSchema } },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const found = await supportableFor(deps, resident);
        const names = await staffNames(deps, found);
        const now = deps.now();

        return found.map((item) => serializeRequest(item, now, names, resident));
      },
    );

    /** «У меня то же самое» по заявке дома. */
    scope.post<{ Params: { id: string } }>(
      '/api/requests/:id/support',
      { schema: { params: idParamsSchema, response: { 200: requestSchema } } },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);
        const { request: updated } = await supportRequest(deps, resident, request.params.id);

        return reply.send(await requestView(deps, updated, resident));
      },
    );

    /** Домовой стучится к соседу сверху: при заливе кран закрывает он. */
    scope.post<{ Params: { id: string } }>(
      '/api/requests/:id/knock',
      { schema: { params: idParamsSchema, response: { 200: requestSchema } } },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);
        const updated = await knockUpstairs(deps, { resident, requestId: request.params.id });

        return reply.send(await requestView(deps, updated, resident));
      },
    );

    /** Какие действия по заявке доступны текущей роли. */
    scope.get<{ Params: { id: string } }>(
      '/api/requests/:id/actions',
      { schema: { params: idParamsSchema } },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const found = await getRequestFor(deps, resident, request.params.id);

        if (!found) throw requestNotFound();

        // Записанная на мастера заявка открывает ему переходы исполнителя.
        const actions = canAct(resident, found)
          ? allowedTransitions(found.status, resident.role, found.assigneeId === resident.id).filter(
              (action) => action !== 'withdrawn' || found.authorId === resident.id,
            )
          : [];

        return { actions };
      },
    );

    /** Приём снимка из мини-приложения. */
    scope.post<{ Body: { contentType: string; data: string } }>(
      '/api/files',
      {
        bodyLimit: FILE_BODY_LIMIT,
        schema: {
          body: {
            type: 'object',
            required: ['contentType', 'data'],
            properties: {
              contentType: { type: 'string', maxLength: 100 },
              data: { type: 'string', maxLength: FILE_BASE64_MAX },
            },
          },
          response: {
            201: {
              type: 'object',
              required: ['kind', 'token'],
              properties: { kind: { type: 'string' }, token: { type: 'string' } },
            },
          },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);
        const attachment = await uploadFile(deps, resident, {
          contentType: request.body.contentType,
          base64: request.body.data,
        });

        return reply.code(201).send(attachment);
      },
    );

    /** Выдача снимка. */
    scope.get<{ Params: { id: string } }>(
      '/api/files/:id',
      { schema: { params: idParamsSchema } },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);
        const file = await readFile(deps, resident, request.params.id);

        return reply
          .type(file.contentType)
          .header('cache-control', 'private, max-age=86400, immutable')
          .send(Buffer.from(file.bytes));
      },
    );

};
