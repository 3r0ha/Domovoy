const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const days = (ms: number): number => Math.round(ms / DAY_MS);
const hours = (ms: number): number => Math.round(ms / HOUR_MS);

/** Как часто объект ломается и когда ждать следующего раза. */
export interface Wear {
  /** Средний промежуток между поломками в днях. Пусто, пока поломка одна. */
  averageDays?: number;
  /** Через сколько дней ждать следующую. Отрицательное, срок уже вышел. */
  dueInDays?: number;
}

/** Сколько поломок нужно, чтобы считать промежуток между ними. */
export const wearOf = (moments: readonly Date[], now: Date): Wear => {
  if (moments.length < 2) return {};

  const sorted = [...moments].sort((left, right) => left.getTime() - right.getTime());
  const first = sorted[0]!.getTime();
  const last = sorted.at(-1)!.getTime();
  // Промежуток считается в часах: округление до суток обнуляло бы две поломки
  // за один день, и прогноз по такому объекту пропадал.
  const averageHours = hours((last - first) / (sorted.length - 1));

  if (averageHours <= 0) return {};

  const average = averageHours * HOUR_MS;

  return { averageDays: Math.max(1, days(average)), dueInDays: days(last + average - now.getTime()) };
};

/** Пора ли ждать поломку. Просроченное больше чем на один свой промежуток не считается. */
export const isWearDue = (wear: Wear, withinDays: number): boolean =>
  wear.averageDays !== undefined &&
  wear.dueInDays !== undefined &&
  wear.dueInDays <= withinDays &&
  wear.dueInDays >= -wear.averageDays;
