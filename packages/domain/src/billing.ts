import { commonNeedsTitle } from './common.js';
import { chargeDetailKey, chargeKey, meterKindKey } from './keys.js';
import { roundMoney } from './numbers.js';
import { METER_RULES, type MeterKind } from './meters.js';
import type { ConsumptionBasis } from './norms.js';
import { outageReduction } from './outages.js';
import { DomainError } from './types.js';

/** Строка квитанции. */
export interface ChargeLine {
  title: string;
  /** К оплате, рубли. */
  amount: number;
  /** Из чего сложилось: «12,4 м³ × 43,50 ₽». Пусто у услуг без счётчика. */
  detail?: string;
  /** Чем посчитано, если не по показаниям жильца. */
  basis?: ConsumptionBasis;
  /** Ключ перевода названия: по нему слой приложения берёт строку на языке жильца. */
  titleKey?: string;
  /** Ресурс строки: по нему переводится название ресурса внутри названия строки. */
  kind?: MeterKind;
  /** Ключ перевода расшифровки. */
  detailKey?: string;
  /**
   * Числа расшифровки без разделителя: его ставит тот, кто показывает строку,
   * по языку человека. Единица ресурса подставляется по {@link ChargeLine.kind}.
   */
  detailValues?: Readonly<Record<string, string | number>>;
}

export interface Charges {
  /** Месяц начисления в виде `ГГГГ-ММ`. */
  period: string;
  lines: ChargeLine[];
  total: number;
  /** Сколько уже оплачено за этот период. */
  paid: number;
  dueDay: number;
}

/** Тарифы дома: рубли за единицу ресурса и за квадратный метр содержания. */
export interface Tariffs {
  meters: Readonly<Record<MeterKind, number>>;
  /** Содержание и текущий ремонт: рубли за квадратный метр в месяц. */
  maintenance: number;
  /** Ключевая ставка долей: от неё считаются пени за просрочку. */
  keyRate: number;
}

/** Тарифы по умолчанию: управляющая компания задаёт свои. */
export const DEFAULT_TARIFFS: Tariffs = {
  meters: {
    cold_water: 43.5,
    hot_water: 210.4,
    electricity: 6.2,
    heating: 2100,
    gas: 8.1,
  },
  maintenance: 32.4,
  keyRate: 0.16,
};

/** До какого числа платят за прошлый месяц. */
export const PAYMENT_DUE_DAY = 10;

/** Числа в квитанции с запятой. */
const decimal = (value: number): string => value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });

/** Как называется способ расчёта в строке квитанции. */
export const BASIS_TITLES: Readonly<Record<ConsumptionBasis, string>> = {
  meter: 'по счётчику',
  average: 'по среднему',
  norm: 'по нормативу',
};

export interface ChargeInput {
  period: string;
  /** Площадь помещения: по ней считается содержание жилья. */
  area: number;
  /** Расход по каждому прибору за период. */
  consumption: {
    kind: MeterKind;
    title: string;
    unit: string;
    amount: number;
    /** Чем посчитано: показанием, средним или нормативом. */
    basis?: ConsumptionBasis;
  }[];
  /** Доля помещения в общедомовом расходе за тот же период. */
  common?: { kind: MeterKind; amount: number }[];
  /** Тарифы дома на этот месяц. Без них считать нечем. */
  tariffs: Tariffs;
  paid?: number;
  /** Часы перерывов сверх нормы по ресурсу: за них плата снижается. */
  outages?: { kind: MeterKind; excessHours: number }[];
}

/** Ставка на ресурс. Без неё начисление вышло бы нечислом. @throws {DomainError} */
const rateFor = (tariffs: Tariffs, kind: MeterKind): number => {
  const rate = tariffs.meters[kind];

  if (!Number.isFinite(rate) || rate < 0) {
    throw new DomainError('tariff_invalid', `Нет тарифа на ресурс «${METER_RULES[kind].title}»: начислять нечем`);
  }

  return rate;
};

/** Числа, из которых складываются деньги. @throws {DomainError} */
const checkAmount = (amount: number, title: string): number => {
  if (!Number.isFinite(amount)) {
    throw new DomainError('tariff_invalid', `Расход по строке «${title}» задан не числом`);
  }

  return amount;
};

/** Начисление за месяц. @throws {DomainError} */
export const chargesFor = (input: ChargeInput): Charges => {
  for (const item of input.consumption) checkAmount(item.amount, item.title);

  // Ноль в квитанцию не идёт, а отрицательная строка идёт: это перерасчёт,
  // и вместе со строкой из квитанции исчезли бы деньги жильца.
  const lines: ChargeLine[] = input.consumption
    .filter((item) => item.amount !== 0)
    .map((item) => {
      const rate = rateFor(input.tariffs, item.kind);

      return {
        title: item.title,
        titleKey: meterKindKey(item.kind),
        kind: item.kind,
        amount: roundMoney(item.amount * rate),
        detail:
          `${decimal(item.amount)} ${item.unit} × ${decimal(rate)} ₽` +
          (item.basis && item.basis !== 'meter' ? ` · ${BASIS_TITLES[item.basis]}` : ''),
        detailKey: chargeDetailKey('rate'),
        detailValues: { расход: item.amount, тариф: rate },
        ...(item.basis && item.basis !== 'meter' ? { basis: item.basis } : {}),
      };
    });

  // Перерасчёт за перерыв дольше нормы: отрицательная строка рядом с ресурсом,
  // чтобы было видно, за что и на сколько снизилась плата.
  for (const outage of input.outages ?? []) {
    const line = lines.find((item) => item.title === METER_RULES[outage.kind].title);

    if (!line || checkAmount(outage.excessHours, line.title) <= 0) continue;

    const reduction = outageReduction(line.amount, outage.excessHours);

    if (reduction <= 0) continue;

    lines.push({
      title: `Перерасчёт: ${line.title.toLowerCase()} отключали дольше нормы`,
      titleKey: chargeKey('recalculation'),
      kind: outage.kind,
      amount: -reduction,
      detail: `${decimal(outage.excessHours)} ч сверх нормы × 0,15% × ${decimal(line.amount)} ₽`,
      detailKey: chargeDetailKey('recalculation'),
      detailValues: { часы: outage.excessHours, сумма: line.amount },
    });
  }

  for (const item of input.common ?? []) {
    const title = commonNeedsTitle(item.kind);

    // Отрицательную разницу дома и квартир по общедомовым нуждам не распределяют.
    if (checkAmount(item.amount, title) <= 0) continue;

    const rate = rateFor(input.tariffs, item.kind);

    lines.push({
      title,
      titleKey: chargeKey('common'),
      kind: item.kind,
      amount: roundMoney(item.amount * rate),
      detail: `${decimal(item.amount)} ${METER_RULES[item.kind].unit} × ${decimal(rate)} ₽`,
      detailKey: chargeDetailKey('rate'),
      detailValues: { расход: item.amount, тариф: rate },
    });
  }

  const maintenance = input.tariffs.maintenance;

  if (!Number.isFinite(input.area) || !Number.isFinite(maintenance)) {
    throw new DomainError('tariff_invalid', 'Площадь помещения и тариф на содержание задаются числами');
  }

  if (input.area > 0 && maintenance > 0) {
    lines.push({
      title: 'Содержание и текущий ремонт',
      titleKey: chargeKey('maintenance'),
      amount: roundMoney(input.area * maintenance),
      detail: `${decimal(input.area)} м² × ${decimal(maintenance)} ₽`,
      detailKey: chargeDetailKey('area'),
      detailValues: { площадь: input.area, тариф: maintenance },
    });
  }

  return {
    period: input.period,
    lines,
    total: roundMoney(lines.reduce((sum, line) => sum + line.amount, 0)),
    paid: roundMoney(input.paid ?? 0),
    dueDay: PAYMENT_DUE_DAY,
  };
};

/** Сколько осталось заплатить. Ноль означает «оплачено». */
export const leftToPay = (charges: Charges): number => roundMoney(Math.max(0, charges.total - charges.paid));
