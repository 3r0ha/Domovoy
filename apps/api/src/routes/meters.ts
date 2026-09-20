import {
  readingsCsv,
  sendReadingsExport,
  readingsTable,
  readMeterPhoto,
  meterHistory,
  metersFor,
  readingProgress,
  submitReading,
  addHouseMeter,
  houseMetersFor,
  speak,
  submitHouseReading,
} from '@domovoy/app';
import {
  DomainError,
  type MeterKind,
} from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';
import {
  asAttachment,
  buildingIdSchema,
  buildingQuerySchema,
  idParamsSchema,
  METER_KINDS,
  meterSchema,
  periodFrom,
  serializeHouseMeter,
  serializeMeter,
} from '../serialize.js';
import { buildXlsx, XLSX_TYPE } from '../xlsx.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Приборы учёта: квартирные, общедомовые и выгрузки. */
export const meterRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

    /** Счётчики квартиры с прошлым показанием. */
    scope.get('/api/meters', { schema: { response: { 200: { type: 'array', items: meterSchema } } } }, async (request) => {
      const resident = await currentResident(request.max.userId);
      const state = await metersFor(deps, resident);
      const now = deps.now();
      const t = speak(resident);

      return state.map((meter) => serializeMeter(meter, now, t));
    });

    /** Сколько квартир дома уже передали показания. Имён в ответе нет. */
    scope.get(
      '/api/meters/progress',
      {
        schema: {
          response: {
            200: { type: 'object', properties: { total: { type: 'integer' }, submitted: { type: 'integer' } } },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const buildingId = resident.buildingId ?? deps.defaultBuildingId;

        return (await readingProgress(deps, buildingId)) ?? {};
      },
    );

    /** Показание с фотографии табло. */
    scope.post<{ Params: { id: string }; Body: { token: string } }>(
      '/api/meters/:id/photo',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['token'],
            additionalProperties: false,
            properties: { token: { type: 'string', minLength: 1, maxLength: 512 } },
          },
          response: {
            200: { type: 'object', properties: { value: { type: 'number' } } },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        const value = await readMeterPhoto(deps, {
          resident,
          meterId: request.params.id,
          token: request.body.token,
        });

        return value === undefined ? {} : { value };
      },
    );

    scope.post<{ Params: { id: string }; Body: { value: number } }>(
      '/api/meters/:id/readings',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['value'],
            additionalProperties: false,
            properties: { value: { type: 'number', minimum: 0 } },
          },
          response: {
            201: {
              type: 'object',
              required: ['value', 'at', 'consumption', 'spike'],
              properties: {
                value: { type: 'number' },
                at: { type: 'string' },
                consumption: { type: 'number' },
                spike: { type: 'boolean' },
                advice: { type: 'string' },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);

        const result = await submitReading(deps, {
          resident,
          meterId: request.params.id,
          value: request.body.value,
        });

        return reply.code(201).send({
          value: result.reading.value,
          at: result.reading.at.toISOString(),
          consumption: result.consumption,
          spike: result.spike,
          ...(result.advice ? { advice: result.advice } : {}),
        });
      },
    );

    scope.get<{ Params: { id: string } }>(
      '/api/meters/:id/history',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['at', 'value', 'consumption'],
                properties: {
                  at: { type: 'string' },
                  value: { type: 'number' },
                  consumption: { type: 'number' },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const history = await meterHistory(deps, resident, request.params.id);

        return history.map((period) => ({
          at: period.at.toISOString(),
          value: period.value,
          consumption: period.consumption,
        }));
      },
    );

    /** Общедомовые приборы: по ним считается расход на общедомовые нужды. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/house-meters',
      {
        schema: {
          querystring: buildingQuerySchema,
          response: { 200: { type: 'array', items: meterSchema } },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const state = await houseMetersFor(deps, resident, request.query.buildingId);
        const now = deps.now();
        const t = speak(resident);

        return state.map((item) => serializeHouseMeter(item, now, t));
      },
    );

    scope.post<{
      Querystring: { buildingId?: string };
      Body: { kind: MeterKind; serial: string; verifiedUntil?: string };
    }>(
      '/api/house-meters',
      {
        schema: {
          querystring: buildingQuerySchema,
          body: {
            type: 'object',
            required: ['kind', 'serial'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: METER_KINDS },
              serial: { type: 'string', minLength: 1, maxLength: 64 },
              // Дата поверки: без формата сюда проходит любая строка, а из неё выходит Invalid Date.
              verifiedUntil: { type: 'string', format: 'date-time' },
            },
          },
          response: { 201: meterSchema },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const verifiedUntil = request.body.verifiedUntil ? new Date(request.body.verifiedUntil) : undefined;

        const meter = await addHouseMeter(deps, resident, {
          kind: request.body.kind,
          serial: request.body.serial,
          ...(verifiedUntil && !Number.isNaN(verifiedUntil.getTime()) ? { verifiedUntil } : {}),
          ...(request.query.buildingId ? { buildingId: request.query.buildingId } : {}),
        });

        return reply
          .code(201)
          .send(
            serializeHouseMeter(
              { meter, lastConsumption: 0, submittedThisMonth: false },
              deps.now(),
              speak(resident),
            ),
          );
      },
    );

    scope.post<{ Params: { id: string }; Body: { value: number } }>(
      '/api/house-meters/:id/readings',
      {
        schema: {
          params: idParamsSchema,
          body: {
            type: 'object',
            required: ['value'],
            additionalProperties: false,
            properties: { value: { type: 'number', minimum: 0 } },
          },
          response: {
            201: {
              type: 'object',
              required: ['value', 'at', 'consumption'],
              properties: {
                value: { type: 'number' },
                at: { type: 'string' },
                consumption: { type: 'number' },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);

        const result = await submitHouseReading(deps, resident, {
          meterId: request.params.id,
          value: request.body.value,
        });

        return reply.code(201).send({
          value: result.reading.value,
          at: result.reading.at.toISOString(),
          consumption: result.consumption,
        });
      },
    );

    /** Показания приборов учёта за месяц, для ГИС ЖКХ. */
    scope.get<{ Querystring: { buildingId?: string; from?: string; to?: string } }>(
      '/api/export/readings.csv',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: {
              buildingId: buildingIdSchema,
              from: { type: 'string', format: 'date-time' },
              to: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        if (resident.role === 'resident') {
          throw new DomainError('forbidden', 'Выгрузку делает управляющая компания');
        }

        const buildingId = resident.buildingId ?? deps.defaultBuildingId;
        const exported = await readingsCsv(deps, buildingId, await periodFrom(deps, request.query, buildingId));

        return asAttachment(reply, exported.filename, 'text/csv; charset=utf-8').send(exported.csv);
      },
    );

    /** Показания прошлого месяца файлом в переписку с ботом: в клиенте MAX так надёжнее. */
    scope.post<{ Querystring: { buildingId?: string } }>(
      '/api/export/readings/send',
      {
        schema: {
          querystring: buildingQuerySchema,
          response: {
            200: {
              type: 'object',
              required: ['filename'],
              properties: { filename: { type: 'string' }, messageId: { type: 'string' } },
            },
          },
        },
      },
      async (request) => sendReadingsExport(deps, await currentResident(request.max.userId, request.query.buildingId)),
    );

    /** Те же показания книгой Excel. */
    scope.get<{ Querystring: { buildingId?: string; from?: string; to?: string } }>(
      '/api/export/readings.xlsx',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: {
              buildingId: buildingIdSchema,
              from: { type: 'string', format: 'date-time' },
              to: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        if (resident.role === 'resident') {
          throw new DomainError('forbidden', 'Выгрузку делает управляющая компания');
        }

        const buildingId = resident.buildingId ?? deps.defaultBuildingId;
        const table = await readingsTable(deps, buildingId, await periodFrom(deps, request.query, buildingId));
        const book = buildXlsx([{ name: 'Показания', rows: [table.columns, ...table.rows] }]);

        return asAttachment(reply, `${table.name}.xlsx`, XLSX_TYPE).send(book);
      },
    );

};
