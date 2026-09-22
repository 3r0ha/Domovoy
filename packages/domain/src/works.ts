import { clockIn, dayIn, daysApart, type Translate } from '@domovoy/i18n';

import { describeAudience } from './audience.js';
import { audiencesOverlap } from './incident.js';
import { russian } from './moment.js';
import { crossedIn } from './numbers.js';
import { CATEGORY_RULES } from './sla.js';
import { DEFAULT_TIME_ZONE, type AnnouncementAudience, type RequestCategory } from './types.js';

/** Плановые работы: отключение, о котором управляющая организация предупредила заранее. */
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

/** Сколько ещё продлится, словами. */
export const describeUntil = (
  work: PlannedWork,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
  t: Translate = russian,
): string => {
  const время = clockIn(t, work.until, timeZone);

  // «Завтра» это следующий календарный день дома: в 30 часах от вечера
  // понедельника лежит среда, и назвать её завтрашней нельзя.
  const apart = daysApart(work.until, now, timeZone);

  if (apart === 0) return t('when.until', { время });
  if (apart === 1) return t('when.untilTomorrow', { время });

  return t('when.untilDay', { день: dayIn(t, work.until, timeZone), время });
};

/** Ответ жильцу вместо заявки. */
export const describeWork = (
  work: PlannedWork,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
  t: Translate = russian,
): string =>
  [
    `${CATEGORY_RULES[work.category].title}: плановые работы ${describeUntil(work, now, timeZone, t)}.`,
    `${work.title}: ${describeAudience(work.audience)}.`,
  ].join('\n');
