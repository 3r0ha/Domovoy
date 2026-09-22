import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'en-GB',
  monthCase: 'name',

  day: '{день} {месяц}',
  dayYear: '{день} {месяц} {год}',
  at: '{день} at {время}',
  weekdayDay: '{неделя}, {день}',

  until: 'until {время}',
  untilTomorrow: 'until {время} tomorrow',
  untilDay: 'until {день}, {время}',

  'minutes.one': '{сколько} minute',
  'minutes.few': '{сколько} minutes',
  'minutes.many': '{сколько} minutes',
  'hours.one': '{сколько} hour',
  'hours.few': '{сколько} hours',
  'hours.many': '{сколько} hours',
  'days.one': '{сколько} day',
  'days.few': '{сколько} days',
  'days.many': '{сколько} days',
  'months.one': '{сколько} month',
  'months.few': '{сколько} months',
  'months.many': '{сколько} months',
  'years.one': '{сколько} year',
  'years.few': '{сколько} years',
  'years.many': '{сколько} years',

  hoursValue: '{сколько} h',
};
