import { METER_RULES, type MeterKind } from './meters.js';

/** Прибор учёта на вводе дома. */
export interface HouseMeter {
  id: string;
  buildingId: string;
  kind: MeterKind;
  /** Заводской номер: по нему сверяют прибор при поверке. */
  serial: string;
  /** Дата следующей поверки. После неё показания считаются недостоверными. */
  verifiedUntil?: Date;
}

export interface CommonNeedsInput {
  /** Расход по общедомовому прибору за месяц. */
  house: number;
  /** Сумма расхода по квартирным приборам за тот же месяц. */
  apartments: number;
  /** Площадь помещения. */
  area: number;
  /** Площадь всех помещений дома. */
  totalArea: number;
}

/** Доля помещения в общедомовом расходе: разница с суммой квартир делится по площади (ПП 354). */
export const commonNeedsFor = ({ house, apartments, area, totalArea }: CommonNeedsInput): number => {
  if (totalArea <= 0 || area <= 0) return 0;

  const extra = house - apartments;

  if (extra <= 0) return 0;

  // Доля не округляется: округлённые поквартирные доли в сумме не дают
  // распределяемый объём. Округление до копеек делает квитанция.
  return extra * (area / totalArea);
};

/** Как общедомовая строка называется в квитанции. */
export const commonNeedsTitle = (kind: MeterKind): string =>
  `${METER_RULES[kind].title} на общие нужды дома`;
