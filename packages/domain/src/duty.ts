import { DEFAULT_TIME_ZONE } from './types.js';

/** Рабочие часы управляющей компании. */
export const WORKING_HOURS = { from: 8, to: 20 } as const;

/** Час по календарю дома: сервер обычно живёт по UTC, а смена, по местному времени. */
export const hourIn = (at: Date, timeZone: string): number =>
  Number(at.toLocaleString('ru-RU', { timeZone, hour: '2-digit', hour12: false }).slice(0, 2));

export const isWorkingHours = (
  at: Date,
  hours: { from: number; to: number } = WORKING_HOURS,
  timeZone: string = DEFAULT_TIME_ZONE,
): boolean => {
  const hour = hourIn(at, timeZone);

  return hour >= hours.from && hour < hours.to;
};

/** Минимум от сотрудника, который нужен правилу дежурства. */
export interface OnDutyLike {
  onDuty?: boolean;
}

/** Кого будить сейчас. */
export const onCall = <T extends OnDutyLike>(
  staff: readonly T[],
  at: Date,
  hours: { from: number; to: number } = WORKING_HOURS,
  timeZone: string = DEFAULT_TIME_ZONE,
): T[] => {
  if (isWorkingHours(at, hours, timeZone)) return [...staff];

  const duty = staff.filter((person) => person.onDuty === true);

  return duty.length > 0 ? duty : [...staff];
};

/** День по календарю дома в виде `ГГГГ-ММ-ДД`: по нему считаются суточные напоминания. */
export const dayIn = (at: Date, timeZone: string = DEFAULT_TIME_ZONE): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
