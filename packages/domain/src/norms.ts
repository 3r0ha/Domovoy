import type { MeterKind } from './meters.js';

/** Чем считали расход за месяц: показанием, средним за прошлые месяцы или нормативом. */
export type ConsumptionBasis = 'meter' | 'average' | 'norm';

/** Сколько месяцев после последнего показания считают по среднему. */
export const AVERAGE_MONTHS = 3;

/** За сколько месяцев берут среднее. */
export const AVERAGE_WINDOW = 6;

/** Повышающий коэффициент к нормативу: прибор есть, а показаний по нему нет. */
export const NORM_FACTOR = 1.5;

/** Коэффициент применяется к воде и электричеству; к отоплению и газу нет. */
export const NORM_FACTOR_KINDS: readonly MeterKind[] = ['cold_water', 'hot_water', 'electricity'];

/**
 * Повышающий коэффициент не применяется там, где прибор учёта установить
 * нельзя: на это составляется акт, и норматив считается без надбавки (ПП 354).
 */
const factorFor = (kind: MeterKind, meterImpossible: boolean): number =>
  meterImpossible || !NORM_FACTOR_KINDS.includes(kind) ? 1 : NORM_FACTOR;

/** Норматив на человека в месяц. Числа типовые: норматив утверждает регион. */
export const NORM_PER_PERSON: Readonly<Record<MeterKind, number>> = {
  cold_water: 4.85,
  hot_water: 3.5,
  electricity: 90,
  gas: 10,
  heating: 0,
};

/** Норматив на квадратный метр в месяц: так считают только отопление. */
export const NORM_PER_AREA: Readonly<Record<MeterKind, number>> = {
  cold_water: 0,
  hot_water: 0,
  electricity: 0,
  gas: 0,
  heating: 0.0166,
};

export interface NormInput {
  kind: MeterKind;
  /** Сколько человек проживает. Ноль означает «неизвестно», считаем за одного. */
  residents: number;
  area: number;
  /** Прибор не установлен по уважительной причине: есть акт о невозможности установки. */
  meterImpossible?: boolean;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Норматив потребления за месяц с повышающим коэффициентом. */
export const normFor = ({ kind, residents, area, meterImpossible = false }: NormInput): number =>
  round(
    (NORM_PER_PERSON[kind] * Math.max(1, residents) + NORM_PER_AREA[kind] * Math.max(0, area)) *
      factorFor(kind, meterImpossible),
  );

export interface EstimateInput {
  kind: MeterKind;
  /**
   * Расход по закрытым месяцам, где показания были. Порядок не важен:
   * среднее берётся по последним {@link AVERAGE_WINDOW} месяцам.
   */
  history: { period: string; amount: number }[];
  /**
   * Сколько расчётных периодов прошло с последнего показания. Ноль означает,
   * что показание за расчётный месяц есть и оценивать нечего.
   */
  monthsSilent: number;
  residents: number;
  area: number;
  /** Прибор не установлен по уважительной причине: норматив считается без надбавки. */
  meterImpossible?: boolean;
}

export interface Estimate {
  amount: number;
  basis: ConsumptionBasis;
}

/**
 * Сколько начислить за месяц, если показаний за него не подали. Три месяца
 * считают по среднему, дальше, по нормативу (ПП 354).
 */
export const estimateConsumption = (input: EstimateInput): Estimate => {
  const norm = { amount: normFor(input), basis: 'norm' as const };

  if (input.monthsSilent > AVERAGE_MONTHS) return norm;

  const window = [...input.history]
    .sort((left, right) => left.period.localeCompare(right.period))
    .slice(-AVERAGE_WINDOW);

  if (window.length === 0) return norm;

  const average = window.reduce((sum, item) => sum + item.amount, 0) / window.length;

  return { amount: round(average), basis: 'average' };
};
