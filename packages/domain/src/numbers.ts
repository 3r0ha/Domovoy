/**
 * Рубли до копеек. Полкопейки округляется от нуля, как принято в расчётах:
 * двоичная дробь даёт 100.49999999999999 там, где в рублях ровно полкопейки,
 * поэтому сравнение идёт с поправкой на неё. Минус ноль не возвращается.
 */
export const roundMoney = (value: number): number => {
  const cents = Math.abs(value) * 100;
  const rounded = Math.round(cents * (1 + Number.EPSILON));

  return (value < 0 ? -rounded : rounded) / 100 + 0;
};

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
