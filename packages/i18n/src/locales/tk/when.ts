import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'tk-TM',
  monthCase: 'name',

  day: '{день} {месяц}',
  dayYear: '{год}-nji ýylyň {день} {месяц}',
  at: '{день}, sagat {время}',
  weekdayDay: '{неделя}, {день}',

  until: 'sagat {время}-a çenli',
  untilTomorrow: 'ertir sagat {время}-a çenli',
  untilDay: '{день}, sagat {время}-a çenli',

  'minutes.one': '{сколько} minut',
  'minutes.few': '{сколько} minut',
  'minutes.many': '{сколько} minut',
  'hours.one': '{сколько} sagat',
  'hours.few': '{сколько} sagat',
  'hours.many': '{сколько} sagat',
  'days.one': '{сколько} gün',
  'days.few': '{сколько} gün',
  'days.many': '{сколько} gün',
  'months.one': '{сколько} aý',
  'months.few': '{сколько} aý',
  'months.many': '{сколько} aý',
  'years.one': '{сколько} ýyl',
  'years.few': '{сколько} ýyl',
  'years.many': '{сколько} ýyl',

  hoursValue: '{сколько} sag',
};
