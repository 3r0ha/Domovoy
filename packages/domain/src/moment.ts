import { clockIn, dayIn, spanIn, translatorFor, weekdayIn, type Translate } from '@domovoy/i18n';

import { DEFAULT_TIME_ZONE } from './types.js';

/**
 * Даты и промежутки словами. Язык приходит переводчиком: у жильца он свой,
 * у смены и у документов его нет, и тогда всё остаётся русским.
 */
export const russian: Translate = translatorFor(undefined);

/** Момент словами: «7 сентября в 09:38». */
export const formatMoment = (at: Date, timeZone: string = DEFAULT_TIME_ZONE, t: Translate = russian): string =>
  t('when.at', { день: dayIn(t, at, timeZone), время: clockIn(t, at, timeZone) });

/** Дата документа: день, месяц и год. */
export const formatDate = (at: Date, timeZone: string = DEFAULT_TIME_ZONE, t: Translate = russian): string =>
  dayIn(t, at, timeZone, true);

/** День без года: «7 сентября». */
export const formatDay = (at: Date, timeZone: string = DEFAULT_TIME_ZONE, t: Translate = russian): string =>
  dayIn(t, at, timeZone);

/**
 * День недели и дата: «четверг, 17 сентября». Приём идёт по дням недели,
 * и одной даты человеку мало, чтобы понять, когда прийти.
 */
export const formatWeekday = (at: Date, timeZone: string = DEFAULT_TIME_ZONE, t: Translate = russian): string =>
  t('when.weekdayDay', { неделя: weekdayIn(t, at, timeZone), день: dayIn(t, at, timeZone) });

/** Часы и минуты: «09:38». */
export const formatClock = (at: Date, timeZone: string = DEFAULT_TIME_ZONE, t: Translate = russian): string =>
  clockIn(t, at, timeZone);

/** Промежуток словами: «15 минут», «3 часа», «2 дня». */
export const formatSpan = (from: Date, to: Date, t: Translate = russian): string =>
  spanIn(t, Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000)));
