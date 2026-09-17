/** Рубли до копеек. */
export const roundMoney = (value: number): number => Math.round(value * 100) / 100;

/** Середина ряда; пустой ряд даёт ноль. */
export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[middle]!;

  return (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Момент в промежутке между двумя проверками: начало не входит, конец входит. */
export const crossedIn = (at: Date, from: Date, to: Date): boolean =>
  at.getTime() > from.getTime() && at.getTime() <= to.getTime();

/** Момент в отчётном периоде: обе границы внутри. */
export const inPeriod = (at: Date, from: Date, to: Date): boolean =>
  at.getTime() >= from.getTime() && at.getTime() <= to.getTime();
