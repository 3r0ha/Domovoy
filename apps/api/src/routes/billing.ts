import {
  chargesForResident,
  payCharges,
  paymentHistory,
  arrearsFor,
  debtRange,
  withoutPeriod,
  payArrears,
  periodTitle,
  listTariffs,
  setTariff,
  houseDebt,
  remindDebtor,
  TARIFF_KINDS,
  type TariffKind,
} from '@domovoy/app';
import { BASIS, DomainError, roundMoney } from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';
import {
  buildingIdSchema,
  serializeTariff,
  tariffSchema,
} from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Деньги: квитанция, оплата, долги и тарифы. */
export const billingRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

    /** Начисление за закрытый месяц и долг за то, что старше него. */
    scope.get('/api/charges', async (request) => {
      const resident = await currentResident(request.max.userId);
      const [charges, all] = await Promise.all([
        chargesForResident(deps, resident),
        arrearsFor(deps, resident),
      ]);

      const debt = withoutPeriod(all, charges.period);
      // Начисленное по нормативу и пени считает продукт: основание идёт рядом с суммой.
      const byNorm = charges.lines.some((line) => line.basis === 'norm');

      const bases: string[] = [
        ...(byNorm ? [BASIS.norm, BASIS.typicalNorm] : []),
        ...(debt.penalty > 0 ? [BASIS.penalty] : []),
      ];

      return {
        ...charges,
        debt: debt.total,
        ...(debt.penalty > 0 ? { penalty: debt.penalty } : {}),
        ...(debtRange(debt) ? { debtFor: debtRange(debt) } : {}),
        ...(bases.length > 0 ? { bases } : {}),
      };
    });

    /** История платежей по квартире. */
    scope.get(
      '/api/payments',
      {
        schema: {
          response: {
            200: {
              type: 'array',
              items: {
                type: 'object',
                required: ['period', 'periodTitle', 'amount', 'at'],
                properties: {
                  period: { type: 'string' },
                  periodTitle: { type: 'string' },
                  amount: { type: 'number' },
                  at: { type: 'string' },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);

        return (await paymentHistory(deps, resident)).map((receipt) => ({
          period: receipt.period,
          periodTitle: periodTitle(receipt.period),
          amount: receipt.amount,
          at: receipt.at.toISOString(),
        }));
      },
    );

    scope.post('/api/charges/pay', async (request) => {
      const resident = await currentResident(request.max.userId);
      const receipt = await payCharges(deps, resident);

      return { period: receipt.period, amount: receipt.amount, at: receipt.at.toISOString() };
    });

    /** Оплата долга: каждый прошлый месяц закрывается своим платежом. */
    scope.post('/api/charges/debt/pay', async (request) => {
      const resident = await currentResident(request.max.userId);
      const receipts = await payArrears(deps, resident);

      return {
        paid: roundMoney(receipts.reduce((sum, receipt) => sum + receipt.amount, 0)),
        periods: receipts.map((receipt) => periodTitle(receipt.period)),
      };
    });

    /** Кто и сколько должен дому. */
    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/debtors',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: {
            200: {
              type: 'object',
              required: ['total', 'penalty', 'debtors'],
              properties: {
                total: { type: 'number' },
                penalty: { type: 'number' },
                debtors: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['residentId', 'displayName', 'debt', 'penalty', 'overdueDays'],
                    properties: {
                      residentId: { type: 'string' },
                      displayName: { type: 'string' },
                      apartmentNumber: { type: 'integer' },
                      debt: { type: 'number' },
                      penalty: { type: 'number' },
                      months: { type: 'string' },
                      overdueDays: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        return houseDebt(deps, resident, request.query.buildingId);
      },
    );

    scope.post<{ Params: { id: string } }>(
      '/api/debtors/:id/remind',
      {
        schema: {
          response: {
            200: { type: 'object', required: ['displayName'], properties: { displayName: { type: 'string' } } },
          },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId);
        const reminded = await remindDebtor(deps, resident, request.params.id);

        return { displayName: reminded.displayName };
      },
    );

    scope.get<{ Querystring: { buildingId?: string } }>(
      '/api/tariffs',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          response: { 200: tariffSchema },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        if (resident.role === 'resident') {
          throw new DomainError('forbidden', 'Тарифы дома ведёт управляющая компания');
        }

        return (await listTariffs(deps, resident)).map(serializeTariff);
      },
    );

    scope.post<{ Querystring: { buildingId?: string }; Body: { kind: string; value: number; since?: string } }>(
      '/api/tariffs',
      {
        schema: {
          querystring: { type: 'object', properties: { buildingId: buildingIdSchema } },
          body: {
            type: 'object',
            required: ['kind', 'value'],
            properties: {
              kind: { type: 'string', enum: TARIFF_KINDS },
              value: { type: 'number', minimum: 0 },
              since: { type: 'string', format: 'date-time' },
            },
          },
          response: { 200: tariffSchema },
        },
      },
      async (request) => {
        const resident = await currentResident(request.max.userId, request.query.buildingId);

        const updated = await setTariff(deps, resident, {
          kind: request.body.kind as TariffKind,
          value: request.body.value,
          ...(request.body.since ? { since: new Date(request.body.since) } : {}),
        });

        return updated.map(serializeTariff);
      },
    );

};
