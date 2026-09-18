import { consumption, isSameMonth, type Reading } from '@domovoy/domain';

/** Прибор вместе с тем, что о нём известно по показаниям. */
export interface ReadingState<M> {
  meter: M;
  /** Последнее принятое показание, если оно есть. */
  last?: Reading;
  /** Расход за прошлый период. */
  lastConsumption: number;
  /** Показание за текущий месяц уже подано. */
  submittedThisMonth: boolean;
}

/** Приборы с их последними показаниями. История передаётся свежими вперёд. */
export const readingStates = <M extends { id: string }>(
  meters: readonly M[],
  readings: readonly Reading[],
  now: Date,
  zone: string,
): ReadingState<M>[] =>
  meters.map((meter) => {
    const own = readings.filter((reading) => reading.meterId === meter.id);
    const [last, previous] = own;

    return {
      meter,
      ...(last ? { last } : {}),
      lastConsumption: last ? consumption(previous, last) : 0,
      submittedThisMonth: last ? isSameMonth(last.at, now, zone) : false,
    };
  });
