import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'ka-GE',
  monthCase: 'name',

  day: '{день} {месяц}',
  dayYear: '{год} წლის {день} {месяц}',
  at: '{день}, {время} საათზე',
  weekdayDay: '{неделя}, {день}',

  until: '{время} საათამდე',
  untilTomorrow: 'ხვალ {время} საათამდე',
  untilDay: '{день}, {время} საათამდე',

  'minutes.one': '{сколько} წუთი',
  'minutes.few': '{сколько} წუთი',
  'minutes.many': '{сколько} წუთი',
  'hours.one': '{сколько} საათი',
  'hours.few': '{сколько} საათი',
  'hours.many': '{сколько} საათი',
  'days.one': '{сколько} დღე',
  'days.few': '{сколько} დღე',
  'days.many': '{сколько} დღე',
  'months.one': '{сколько} თვე',
  'months.few': '{сколько} თვე',
  'months.many': '{сколько} თვე',
  'years.one': '{сколько} წელი',
  'years.few': '{сколько} წელი',
  'years.many': '{сколько} წელი',

  hoursValue: '{сколько} სთ',
};
