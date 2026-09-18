import {
  devicesFor,
  inviteGuest,
  activeGuestCodes,
  isSilent,
  sensorsFor,
  journalFor,
  openDevice,
  revokeGuestCode,
  viewDevice,
} from '@domovoy/app';
import type { FastifyPluginAsync } from 'fastify';
import {
  buildingIdSchema,
  buildingQuerySchema,
  codeParamsSchema,
  idParamsSchema,
  JOURNAL_LIMIT,
} from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Умный дом: двери, камеры и гостевые коды. */
export const deviceRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

    /** Жильцу, его подъезд и общедомовое, сотруднику, всё оборудование дома. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/devices',
      { schema: { querystring: buildingQuerySchema } },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;

        return devicesFor(deps, resident, apartment?.entrance);
      },
    );

    /** Открыть дверь: домофон или шлагбаум. */
    scope.post<{ Params: { id: string } }>(
      '/api/devices/:id/open',
      { schema: { params: idParamsSchema } },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const device = await openDevice(deps, resident, request.params.id);

        return { id: device.id, title: device.title };
      },
    );

    /** Кадр с камеры прямо сейчас. */
    scope.get<{ Params: { id: string } }>(
      '/api/devices/:id/snapshot',
      { schema: { params: idParamsSchema } },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const shot = await viewDevice(deps, resident, request.params.id);

        return { deviceId: shot.deviceId, at: shot.at.toISOString(), image: shot.image };
      },
    );

    /** Одноразовый код для гостя. */
    scope.post<{ Params: { id: string } }>(
      '/api/devices/:id/guest',
      { schema: { params: idParamsSchema } },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const issued = await inviteGuest(deps, resident, request.params.id);

        return { code: issued.code, deviceId: issued.deviceId, expiresAt: issued.expiresAt.toISOString() };
      },
    );

    /** Датчики дома и когда каждый выходил на связь. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/devices/sensors',
      { schema: { querystring: buildingQuerySchema } },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const now = deps.now();

        return (await sensorsFor(deps, resident)).map((device) => ({
          id: device.id,
          kind: device.kind,
          title: device.title,
          silent: isSilent(device, now),
          ...(device.lastSeenAt ? { lastSeenAt: device.lastSeenAt.toISOString() } : {}),
        }));
      },
    );

    /** Коды, которые сейчас на руках у гостей. */
    scope.get('/api/devices/guest-codes', async (request) => {
      const resident = await currentResident(request.max.userId);

      return (await activeGuestCodes(deps, resident)).map((issued) => ({
        code: issued.code,
        deviceId: issued.deviceId,
        expiresAt: issued.expiresAt.toISOString(),
      }));
    });

    /** Отозвать выданный код, не дожидаясь истечения. */
    scope.post<{ Params: { code: string } }>(
      '/api/devices/guest-codes/:code/revoke',
      { schema: { params: codeParamsSchema } },
      async (request, reply) => {
        const resident = await currentResident(request.max.userId);

        await revokeGuestCode(deps, resident, request.params.code);

        return reply.code(204).send();
      },
    );

    /** Журнал открытий: кто и когда открывал двери дома. */
    scope.get<{ Querystring: { before?: string; limit?: number; buildingId?: string } }>(
      '/api/devices/journal',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: {
              before: { type: 'string', format: 'date-time' },
              limit: { type: 'integer', minimum: 1, maximum: JOURNAL_LIMIT },
              buildingId: buildingIdSchema,
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);
        const before = request.query.before ? new Date(request.query.before) : undefined;
        const limit = request.query.limit ?? JOURNAL_LIMIT;

        const events = (await journalFor(deps, resident))
          .filter((event) => !before || event.at.getTime() < before.getTime())
          .reverse()
          .slice(0, limit);

        const names = new Map(
          events.length > 0 && resident.buildingId
            ? (await deps.repository.listResidents(resident.buildingId)).map((person) => [
                person.id,
                person.displayName,
              ])
            : [],
        );

        return events.map((event) => ({
          deviceId: event.deviceId,
          at: event.at.toISOString(),
          action: event.action,
          by: event.by,
          ...(event.residentId && names.has(event.residentId) ? { who: names.get(event.residentId) } : {}),
        }));
      },
    );

};
