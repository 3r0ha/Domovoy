import { momentIn, partsIn } from '@domovoy/domain';

/**
 * Тихие часы. Продукт умеет писать круглосуточно, а дом ночью спит: объявление
 * об отключении, опубликованное в полночь, будит подъезд ради сведений,
 * которые нужны утром. Поэтому несрочная рассылка ждёт утра, а авария и
 * начавшиеся работы уходят сразу.
 */

/** С какого часа дом не беспокоят. */
export const QUIET_FROM = 22;

/** С какого часа можно писать снова. */
export const QUIET_UNTIL = 8;

/** Ночь ли сейчас по времени дома. */
export const isQuiet = (now: Date, timeZone?: string): boolean => {
  const { hour } = partsIn(now, timeZone);

  return hour >= QUIET_FROM || hour < QUIET_UNTIL;
};

/** Ближайшее утро в этом доме: момент, в который тишина заканчивается. */
export const nextMorning = (now: Date, timeZone?: string): Date => {
  const { year, month, day, hour } = partsIn(now, timeZone);
  const today = momentIn({ year, month, day, hour: QUIET_UNTIL, minute: 0 }, timeZone);

  if (hour < QUIET_UNTIL) return today;

  const tomorrow = partsIn(new Date(now.getTime() + 24 * 3600_000), timeZone);

  return momentIn(
    { year: tomorrow.year, month: tomorrow.month, day: tomorrow.day, hour: QUIET_UNTIL, minute: 0 },
    timeZone,
  );
};

/** Сколько часов впереди считается «работы уже вот-вот». */
const SOON_HOURS = 12;

/**
 * Можно ли будить. Ночью будят авария, объявление, рождённое из заявки, и
 * работы, которые идут или начнутся в ближайшие часы: о них надо знать сейчас.
 */
export const wakesHouse = (input: { works?: { from: Date }; requestId?: string }, now: Date): boolean => {
  if (input.requestId) return true;

  const from = input.works?.from;

  return from !== undefined && from.getTime() - now.getTime() <= SOON_HOURS * 3600_000;
};
