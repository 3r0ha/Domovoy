import {
  acceptLegal,
  askAssistant,
  bindApartment,
  legalAccepted,
  listOwnApartments,
  useApartment,
  describeContext,
  forgetContact,
  saveContact,
  listNotices,
  setNotice,
  exportPersonalData,
  forgetResident,
  formatPersonalData,
  elderOf,
  demoRoles,
  takeDemoRole,
  zoneOf,
  type Building,
  type Resident,
} from '@domovoy/app';
import {
  DomainError,
  LEGAL_VERSION,
  READING_WINDOW,
  type NoticeKind,
  type Role,
} from '@domovoy/domain';
import { verifyContact } from '@maxkit/server';
import type { FastifyPluginAsync } from 'fastify';
import {
  asTitle,
  noticeSchema,
} from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Профиль, уведомления, телефон и свои данные. */
export const meRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  /** Канал доставки файлов: наклейки и выгрузки уходят в переписку с ботом. */
  const deliversFiles = typeof deps.notifier?.sendFile === 'function';

  /**
   * Что в этой установке работает на модельном подключении. Кейс требует не
   * имитировать интеграции: пометка доходит до человека, а не только до README.
   */
  const modelIntegrations = (given: RoutesDeps): string[] =>
    [
      given.hub?.model && 'doors',
      given.payments?.model && 'payments',
      given.handoffs?.model && 'handoff',
    ].filter((name): name is string => typeof name === 'string');

  /** Дом смены: у жильца его нет, а у сотрудника он может отличаться от своего. */
  const houseOfShift = async (resident: Resident): Promise<Building | undefined> =>
    resident.role === 'resident'
      ? undefined
      : deps.repository.findBuilding(resident.buildingId ?? deps.defaultBuildingId);

    scope.get('/api/me', async (request) => {
      const resident = await currentResident(request.max.userId);
      const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;
      const building = await deps.repository.findBuilding(
        apartment?.buildingId ?? resident.buildingId ?? deps.defaultBuildingId,
      );
      const eldership = apartment ? await elderOf(deps, apartment.buildingId, apartment.entrance) : undefined;

      const workHouse = await houseOfShift(resident);

      return {
        id: resident.id,
        displayName: resident.displayName,
        role: resident.role,
        apartmentId: resident.apartmentId ?? null,
        ...(eldership?.residentId === resident.id
          ? { elder: { entrance: eldership.entrance, until: eldership.until.toISOString() } }
          : {}),
        ...(apartment ? { apartmentNumber: apartment.number } : {}),
        ...(building?.address ? { address: building.address } : {}),
        ...(resident.phone ? { phone: resident.phone } : {}),
        ...(resident.role === 'resident' ? {} : { onDuty: resident.onDuty ?? false }),
        readingWindow: { fromDay: READING_WINDOW.fromDay, toDay: READING_WINDOW.toDay },
        meterPhoto: Boolean(deps.vision),
        // Приём по записи ведут не все организации: без окон раздела нет.
        // У смены он про дом смены, у жильца про дом его квартиры.
        reception: Boolean(building?.reception?.length || workHouse?.reception?.length),
        // Режим проверки: жюри примеряет роли прямо в приложении.
        demo: Boolean(deps.demo),
        // Файлы доставляет бот: без канала наклейки и выгрузки показывать нечем.
        files: deliversFiles,
        // Что подключено в этой установке: без поставщика раздел не показывают.
        payments: Boolean(deps.payments),
        doors: Boolean(deps.hub),
        // Модельные подключения: человек должен видеть, что за ними нет обмена.
        model: modelIntegrations(deps),
        // Согласие с документами: без него продукт сначала показывает их.
        legal: { version: LEGAL_VERSION, accepted: legalAccepted(resident) },
      };
    });

    /** Согласие с действующей редакцией документов. */
    scope.post(
      '/api/me/legal',
      {
        schema: {
          response: {
            200: {
              type: 'object',
              required: ['version', 'accepted'],
              properties: { version: { type: 'string' }, accepted: { type: 'boolean' } },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const saved = await acceptLegal(deps, resident);

        return { version: LEGAL_VERSION, accepted: legalAccepted(saved) };
      },
    );

    /** Помощник по приложению: короткий ответ и готовый переход в раздел. */
    scope.post<{ Body: { question: string } }>(
      '/api/assistant',
      {
        schema: {
          body: {
            type: 'object',
            required: ['question'],
            properties: { question: { type: 'string', minLength: 1, maxLength: 500 } },
          },
          response: {
            200: {
              type: 'object',
              required: ['answer', 'by'],
              properties: {
                answer: { type: 'string' },
                screen: { type: 'string' },
                title: { type: 'string' },
                command: { type: 'string' },
                offTopic: { type: 'boolean' },
                by: { type: 'string', enum: ['model', 'keywords'] },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        return askAssistant(deps, resident, request.body.question);
      },
    );

    /** Роли для проверки: список и примерка. Только в режиме проверки. */
    scope.get(
      '/api/demo',
      {
        schema: {
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['role', 'title', 'about', 'current'],
                properties: {
                  role: { type: 'string' },
                  title: { type: 'string' },
                  about: { type: 'string' },
                  current: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      async (request) => {
        if (!deps.demo) throw new DomainError('forbidden', 'Режим проверки выключен');

        return demoRoles(await currentResident(request.max.userId));
      },
    );

    scope.post<{ Body: { role: Role } }>(
      '/api/demo',
      {
        schema: {
          body: {
            type: 'object',
            required: ['role'],
            properties: {
              role: { type: 'string', enum: ['resident', 'dispatcher', 'technician', 'manager', 'contractor'] },
            },
          },
        },
      },
      async (request) => {
        if (!deps.demo) throw new DomainError('forbidden', 'Режим проверки выключен');

        const resident = await currentResident(request.max.userId);
        const saved = await takeDemoRole(deps, resident, request.body.role);

        return { role: saved.role, displayName: saved.displayName };
      },
    );

    scope.get(
      '/api/me/data',
      { schema: { response: { 200: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } } } },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const data = await exportPersonalData(deps, resident);

        return { text: formatPersonalData(data, await zoneOf(deps, resident.buildingId)) };
      },
    );

    /** Что человеку присылать. Аварии и свои заявки отключить нельзя. */
    scope.get('/api/me/notices', { schema: { response: { 200: noticeSchema } } }, async (request) =>
      listNotices(await currentResident(request.max.userId)),
    );

    scope.post<{ Body: { kind: string; on: boolean } }>(
      '/api/me/notices',
      {
        schema: {
          body: {
            type: 'object',
            required: ['kind', 'on'],
            properties: { kind: { type: 'string' }, on: { type: 'boolean' } },
          },
          response: { 200: noticeSchema },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        return setNotice(deps, resident, request.body.kind as NoticeKind, request.body.on);
      },
    );

    /** Телефон жильца из `requestContact`. */
    scope.post<{ Body: { phone: string; authDate?: string; hash?: string } }>(
      '/api/me/contact',
      {
        schema: {
          body: {
            type: 'object',
            required: ['phone'],
            properties: {
              phone: { type: 'string', maxLength: 32 },
              authDate: { type: 'string', maxLength: 32 },
              hash: { type: 'string', maxLength: 128 },
            },
          },
          response: {
            200: { type: 'object', required: ['phone'], properties: { phone: { type: 'string' } } },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const { phone, authDate, hash } = request.body;

        if (deps.botToken) {
          const signed =
            authDate !== undefined &&
            hash !== undefined &&
            verifyContact({ botToken: deps.botToken, phone, authDate, userId: request.max.userId, hash });

          if (!signed) throw new DomainError('contact_not_verified', 'Телефон не подтверждён платформой');
        }

        const saved = await saveContact(deps, resident, phone);

        return { phone: saved.phone ?? phone };
      },
    );

    scope.delete('/api/me/contact', async (request, reply) => {
      await forgetContact(deps, await currentResident(request.max.userId));

      return reply.code(204).send();
    });

    /** Удаление профиля: связь с человеком снимается, история дома остаётся. */
    scope.delete('/api/me', async (request, reply) => {
      const resident = await currentResident(request.max.userId);

      await forgetResident(deps, resident);

      return reply.code(204).send();
    });

    /** Что означает код с наклейки. */
    scope.get<{ Params: { startParam: string } }>('/api/context/:startParam', async (request, reply) => {
      const described = await describeContext(deps, request.params.startParam);

      if (!described) return reply.code(404).send({ error: 'unknown_target', message: 'Код объекта не распознан' });

      return { ...described, target: asTitle(described.target) };
    });

    /** Привязка к квартире по коду из квитанции. */
    scope.post<{ Body: { code: string } }>(
      '/api/me/apartment',
      {
        schema: {
          body: {
            type: 'object',
            required: ['code'],
            properties: { code: { type: 'string', maxLength: 512 } },
          },
          response: {
            200: {
              type: 'object',
              required: ['apartmentId', 'number', 'alreadyBound'],
              properties: {
                apartmentId: { type: 'string' },
                number: { type: 'integer' },
                alreadyBound: { type: 'boolean' },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const bound = await bindApartment(deps, resident, request.body.code);

        return {
          apartmentId: bound.apartment.id,
          number: bound.apartment.number,
          alreadyBound: bound.alreadyBound,
        };
      },
    );

    /** Квартиры человека: их может быть несколько, в том числе в разных домах. */
    scope.get(
      '/api/me/apartments',
      {
        schema: {
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'number', 'buildingId', 'address', 'current'],
                properties: {
                  id: { type: 'string' },
                  number: { type: 'integer' },
                  buildingId: { type: 'string' },
                  address: { type: 'string' },
                  current: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      async (request) => listOwnApartments(deps, await currentResident(request.max.userId)),
    );

    /** Переключиться на другую свою квартиру: показания и квитанция идут по ней. */
    scope.post<{ Body: { apartmentId: string } }>(
      '/api/me/apartment/use',
      {
        schema: {
          body: {
            type: 'object',
            required: ['apartmentId'],
            properties: { apartmentId: { type: 'string', maxLength: 128 } },
          },
          response: {
            200: {
              type: 'object',
              required: ['apartmentId'],
              properties: { apartmentId: { type: 'string' }, buildingId: { type: 'string' } },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const saved = await useApartment(deps, resident, request.body.apartmentId);

        return { apartmentId: saved.apartmentId, ...(saved.buildingId ? { buildingId: saved.buildingId } : {}) };
      },
    );

};
