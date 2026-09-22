import type { PaymentGateway, Receipt } from './billing.js';

/** Заглушка платёжного шлюза: запоминает оплаты в памяти. */
export interface MockPaymentsOptions {
  now: () => Date;
}

export interface MockPayments extends PaymentGateway {
  readonly receipts: Receipt[];
}

const key = (apartmentId: string, period: string): string => `${apartmentId}:${period}`;

export const createMockPayments = (options: MockPaymentsOptions): MockPayments => {
  const receipts: Receipt[] = [];
  const totals = new Map<string, number>();
  const owners = new WeakMap<Receipt, string>();

  return {
    receipts,
    model: true,

    async pay({ apartmentId, period, amount }) {
      // Номер чека выдаёт шлюз: по 54-ФЗ он возвращается вместе с платежом.
      // Подключение модельное, поэтому номер считается по порядку.
      const receipt: Receipt = {
        period,
        amount,
        at: options.now(),
        receiptNumber: `Ч-${String(receipts.length + 1).padStart(6, '0')}`,
      };

      totals.set(key(apartmentId, period), (totals.get(key(apartmentId, period)) ?? 0) + amount);
      owners.set(receipt, apartmentId);
      receipts.push(receipt);

      return receipt;
    },

    async paid(apartmentId, period) {
      return totals.get(key(apartmentId, period)) ?? 0;
    },

    async history(apartmentId, limit) {
      const own = [...receipts]
        .reverse()
        .filter((receipt) => owners.get(receipt) === apartmentId)
        .sort((left, right) => right.at.getTime() - left.at.getTime());

      return limit === undefined ? own : own.slice(0, limit);
    },
  };
};
