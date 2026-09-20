import {
  METER_RULES,
  estimateConsumption,
  type ConsumptionBasis,
  type Meter,
  type MeterKind,
  type Reading,
} from '@domovoy/domain';

import { periodOf } from './billing.js';

/** Показание, приведённое к месяцу дома. */
interface Taken {
  period: string;
  value: number;
}

/** Расход за месяц по одной строке квитанции. */
export interface PeriodConsumption {
  kind: MeterKind;
  title: string;
  unit: string;
  amount: number;
  basis: ConsumptionBasis;
}

/** Предыдущий месяц в том же виде `ГГГГ-ММ`. */
export const monthBefore = (period: string): string => {
  const [year, month] = period.split('-').map(Number);
  const at = new Date(Date.UTC(year!, (month ?? 1) - 2, 1));

  return `${at.getUTCFullYear()}-${`${at.getUTCMonth() + 1}`.padStart(2, '0')}`;
};

const offsetAt = (at: Date, zone: string): number => {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;

  const [, sign, hours, minutes] = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '') ?? [];

  if (!sign) return 0;

  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
};

/** Первый миг месяца по календарю дома. */
export const startOfPeriod = (period: string, zone: string): Date => {
  const [year, month] = period.split('-').map(Number);
  const wall = Date.UTC(year!, (month ?? 1) - 1, 1);

  return new Date(wall - offsetAt(new Date(wall), zone));
};

/** Последний миг месяца по календарю дома. */
export const endOfPeriod = (period: string, zone: string): Date => {
  const [year, month] = period.split('-').map(Number);
  const wall = Date.UTC(year!, month ?? 1, 1);

  return new Date(wall - offsetAt(new Date(wall), zone) - 1);
};

/** Сколько месяцев между двумя периодами. */
const monthsBetween = (from: string, to: string): number => {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);

  return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!);
};

const taken = (readings: readonly Reading[], meterId: string, zone: string): Taken[] =>
  readings
    .filter((reading) => reading.meterId === meterId)
    .map((reading) => ({ period: periodOf(reading.at, zone), value: reading.value }))
    .sort((left, right) => left.period.localeCompare(right.period));

/** Расход по каждой паре соседних показаний: из него берут среднее. */
const deltas = (history: Taken[], upTo: string): { period: string; amount: number }[] =>
  history
    .filter((item) => item.period <= upTo)
    .slice(1)
    .map((item, index) => ({
      period: item.period,
      amount: Math.max(0, Math.round((item.value - history[index]!.value) * 1000) / 1000),
    }));

export interface ConsumptionInput {
  meters: readonly Meter[];
  readings: readonly Reading[];
  /** Месяц начисления в виде `ГГГГ-ММ`. */
  period: string;
  zone: string;
  /** Сколько человек проживает: по этому числу считается норматив. */
  residents: number;
  area: number;
}

/**
 * Расход по приборам квартиры за месяц. Если показаний за месяц нет, считаем
 * по среднему, а после трёх таких месяцев по нормативу.
 */
export const periodConsumption = (input: ConsumptionInput): PeriodConsumption[] =>
  input.meters.map((meter) => {
    const rule = METER_RULES[meter.kind];
    const history = taken(input.readings, meter.id, input.zone);
    const own = deltas(history, input.period);
    const last = history.filter((item) => item.period <= input.period).at(-1);
    const measured = own.at(-1);

    if (last?.period === input.period) {
      const amount = measured?.period === input.period ? measured.amount : 0;

      return { kind: meter.kind, title: rule.title, unit: rule.unit, amount, basis: 'meter' };
    }

    const estimate = estimateConsumption({
      kind: meter.kind,
      history: own,
      monthsSilent: last ? monthsBetween(last.period, input.period) : Number.POSITIVE_INFINITY,
      residents: input.residents,
      area: input.area,
    });

    return {
      kind: meter.kind,
      title: rule.title,
      unit: rule.unit,
      amount: estimate.amount,
      basis: estimate.basis,
    };
  });
