import { describeAudience } from './audience.js';
import { audiencesOverlap } from './incident.js';
import { crossedIn } from './numbers.js';
import { CATEGORY_RULES } from './sla.js';
import { DEFAULT_TIME_ZONE, type AnnouncementAudience, type RequestCategory } from './types.js';

/** Плановые работы: отключение, о котором управляющая компания предупредила заранее. */
export interface PlannedWork {
  id: string;
  title: string;
  /** Что не работает: по ней обращение и сопоставляется с работами. */
  category: RequestCategory;
  audience: AnnouncementAudience;
  from: Date;
  until: Date;
}

/** Идут ли работы прямо сейчас. */
export const isUnderway = (work: PlannedWork, now: Date): boolean =>
  now.getTime() >= work.from.getTime() && now.getTime() < work.until.getTime();

/** За сколько до начала работ напомнить. */
export const WORKS_WARNING_HOURS = 24;

export type WorksEvent = 'soon' | 'started' | 'finished';

/** Что случилось с работами между двумя проверками. */
export const worksCrossedIn = (work: PlannedWork, from: Date, to: Date): WorksEvent | null => {
  const within = (at: Date): boolean => crossedIn(at, from, to);

  if (within(new Date(work.from.getTime() - WORKS_WARNING_HOURS * 3600_000))) return 'soon';
  if (within(work.from)) return 'started';
  if (within(work.until)) return 'finished';

  return null;
};

/** Работы, объясняющие обращение жильца. */
export const explainingWork = (
  works: readonly PlannedWork[],
  where: AnnouncementAudience,
  category: RequestCategory,
  now: Date,
): PlannedWork | undefined =>
  works.find(
    (work) => work.category === category && isUnderway(work, now) && audiencesOverlap(work.audience, where),
  );

const DAY_MS = 24 * 3600_000;

/** Календарный день в заданном поясе: по нему решается, нужна ли дата. */
const dayIn = (at: Date, timeZone: string): string =>
  at.toLocaleDateString('ru-RU', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Сколько ещё продлится, словами. */
export const describeUntil = (work: PlannedWork, now: Date, timeZone: string = DEFAULT_TIME_ZONE): string => {
  const time = work.until.toLocaleTimeString('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit' });
  const until = dayIn(work.until, timeZone);

  if (until === dayIn(now, timeZone)) return `до ${time}`;

  // «Завтра» это следующий календарный день дома: в 30 часах от вечера
  // понедельника лежит среда, и назвать её завтрашней нельзя.
  if (until === dayIn(new Date(now.getTime() + DAY_MS), timeZone)) return `до ${time} завтра`;

  return `до ${work.until.toLocaleDateString('ru-RU', { timeZone, day: 'numeric', month: 'long' })}, ${time}`;
};

/** Ответ жильцу вместо заявки. */
export const describeWork = (work: PlannedWork, now: Date, timeZone: string = DEFAULT_TIME_ZONE): string =>
  [
    `${CATEGORY_RULES[work.category].title}: плановые работы ${describeUntil(work, now, timeZone)}.`,
    `${work.title}: ${describeAudience(work.audience)}.`,
  ].join('\n');
