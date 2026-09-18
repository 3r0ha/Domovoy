import { days, plural } from './russian.js';
import { DEFAULT_TIME_ZONE } from './types.js';

/** Момент словами: «7 сентября, 09:38». */
export const formatMoment = (at: Date, timeZone: string = DEFAULT_TIME_ZONE): string =>
  at.toLocaleString('ru-RU', {
    timeZone,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Дата документа: день, месяц и год. */
export const formatDate = (at: Date, timeZone: string = DEFAULT_TIME_ZONE): string =>
  at.toLocaleDateString('ru-RU', { timeZone, day: 'numeric', month: 'long', year: 'numeric' });

/** День без года: «7 сентября». */
export const formatDay = (at: Date, timeZone: string = DEFAULT_TIME_ZONE): string =>
  at.toLocaleDateString('ru-RU', { timeZone, day: 'numeric', month: 'long' });

/**
 * День недели и дата: «четверг, 17 сентября». Приём идёт по дням недели,
 * и одной даты человеку мало, чтобы понять, когда прийти.
 */
export const formatWeekday = (at: Date, timeZone: string = DEFAULT_TIME_ZONE): string =>
  at.toLocaleDateString('ru-RU', { timeZone, weekday: 'long', day: 'numeric', month: 'long' });

/** Часы и минуты: «09:38». */
export const formatClock = (at: Date, timeZone: string = DEFAULT_TIME_ZONE): string =>
  at.toLocaleTimeString('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit' });

/**
 * Промежуток словами: «15 минут», «3 часа», «2 дня», «полтора месяца». Человек
 * не переводит в уме 355 минут в часы, поэтому крупные промежутки называются
 * крупными единицами, а мелкие подробности отбрасываются.
 */
export const formatSpan = (from: Date, to: Date): string => {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));

  if (minutes < 60) return plural(minutes, 'минуту', 'минуты', 'минут');

  const hours = Math.round(minutes / 60);

  if (hours < 24) return plural(hours, 'час', 'часа', 'часов');

  const whole = Math.round(minutes / (24 * 60));

  if (whole < 31) return days(whole);

  const months = Math.round(whole / 30);

  if (months < 12) return plural(months, 'месяц', 'месяца', 'месяцев');

  return plural(Math.round(months / 12), 'год', 'года', 'лет');
};
