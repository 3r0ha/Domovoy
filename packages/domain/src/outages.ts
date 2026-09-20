import type { MeterKind } from './meters.js';

/**
 * Допустимая продолжительность перерывов по приложению 1 к Правилам № 354:
 * суммарно за месяц и за один перерыв, в часах. За каждый час сверх нормы
 * плата за ресурс за расчётный период снижается на 0,15 процента.
 */
export interface OutageLimit {
  monthly: number;
  single: number;
}

export const OUTAGE_LIMITS: Readonly<Record<MeterKind, OutageLimit>> = {
  cold_water: { monthly: 8, single: 4 },
  hot_water: { monthly: 8, single: 4 },
  electricity: { monthly: 2, single: 2 },
  heating: { monthly: 24, single: 16 },
  gas: { monthly: 4, single: 4 },
};

/** Снижение платы за час сверх нормы: 0,15 процента платы за период. */
export const OUTAGE_REDUCTION_PER_HOUR = 0.0015;

export interface Outage {
  kind: MeterKind;
  from: Date;
  until: Date;
}

const HOUR_MS = 60 * 60 * 1000;

/** Часы перерыва внутри расчётного периода: край месяца обрезает перерыв. */
const hoursWithin = (outage: Outage, from: Date, to: Date): number => {
  const start = Math.max(outage.from.getTime(), from.getTime());
  const end = Math.min(outage.until.getTime(), to.getTime());

  return end > start ? (end - start) / HOUR_MS : 0;
};

/**
 * Часы сверх нормы по одному ресурсу за период. Считаются и превышение
 * месячной суммы, и превышение одного перерыва; берётся большее, чтобы один
 * и тот же час не снижал плату дважды.
 */
export const excessOutageHours = (
  kind: MeterKind,
  outages: readonly Outage[],
  period: { from: Date; to: Date },
): number => {
  const limit = OUTAGE_LIMITS[kind];
  const hours = outages.filter((outage) => outage.kind === kind).map((outage) => hoursWithin(outage, period.from, period.to));
  const total = hours.reduce((sum, value) => sum + value, 0);
  const overMonthly = Math.max(0, total - limit.monthly);
  const overSingle = hours.reduce((sum, value) => sum + Math.max(0, value - limit.single), 0);

  return Math.round(Math.max(overMonthly, overSingle) * 100) / 100;
};

/** Насколько снижается плата за ресурс. */
export const outageReduction = (amount: number, excessHours: number): number =>
  Math.round(amount * OUTAGE_REDUCTION_PER_HOUR * excessHours * 100) / 100;
