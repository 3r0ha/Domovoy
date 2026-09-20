import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'uz-UZ',
  monthCase: 'name',

  day: '{день}-{месяц}',
  dayYear: '{год}-yil {день}-{месяц}',
  at: '{день}, soat {время}',
  weekdayDay: '{неделя}, {день}',

  until: 'soat {время} gacha',
  untilTomorrow: 'ertaga soat {время} gacha',
  untilDay: '{день}, soat {время} gacha',

  'minutes.one': '{сколько} daqiqa',
  'minutes.few': '{сколько} daqiqa',
  'minutes.many': '{сколько} daqiqa',
  'hours.one': '{сколько} soat',
  'hours.few': '{сколько} soat',
  'hours.many': '{сколько} soat',
  'days.one': '{сколько} kun',
  'days.few': '{сколько} kun',
  'days.many': '{сколько} kun',
  'months.one': '{сколько} oy',
  'months.few': '{сколько} oy',
  'months.many': '{сколько} oy',
  'years.one': '{сколько} yil',
  'years.few': '{сколько} yil',
  'years.many': '{сколько} yil',

  hoursValue: '{сколько} soat',
};
