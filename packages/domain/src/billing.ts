import { commonNeedsTitle } from './common.js';
import { roundMoney } from './numbers.js';
import { METER_RULES, type MeterKind } from './meters.js';
import type { ConsumptionBasis } from './norms.js';

/** Строка квитанции. */
export interface ChargeLine {
  title: string;
  /** К оплате, рубли. */
  amount: number;
  /** Из чего сложилось: «12,4 м³ × 43,50 ₽». Пусто у услуг без счётчика. */
  detail?: string;
  /** Чем посчитано, если не по показаниям жильца. */
  basis?: ConsumptionBasis;
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
}

/** Начисление за месяц. */
export const chargesFor = (input: ChargeInput): Charges => {
  const lines: ChargeLine[] = input.consumption
    .filter((item) => item.amount > 0)
    .map((item) => ({
      title: item.title,
      amount: roundMoney(item.amount * input.tariffs.meters[item.kind]),
      detail:
        `${decimal(item.amount)} ${item.unit} × ${decimal(input.tariffs.meters[item.kind])} ₽` +
        (item.basis && item.basis !== 'meter' ? ` · ${BASIS_TITLES[item.basis]}` : ''),
      ...(item.basis && item.basis !== 'meter' ? { basis: item.basis } : {}),
    }));

  for (const item of input.common ?? []) {
    if (item.amount <= 0) continue;

    const rate = input.tariffs.meters[item.kind];

    lines.push({
      title: commonNeedsTitle(item.kind),
      amount: roundMoney(item.amount * rate),
      detail: `${decimal(item.amount)} ${METER_RULES[item.kind].unit} × ${decimal(rate)} ₽`,
    });
  }

  if (input.area > 0 && input.tariffs.maintenance > 0) {
    lines.push({
      title: 'Содержание и текущий ремонт',
      amount: roundMoney(input.area * input.tariffs.maintenance),
      detail: `${decimal(input.area)} м² × ${decimal(input.tariffs.maintenance)} ₽`,
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
