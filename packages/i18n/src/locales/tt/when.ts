import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'tt-RU',
  monthCase: 'name',

  day: '{день} {месяц}',
  dayYear: '{год} елның {день} {месяц}',
  at: '{день}, {время}',
  weekdayDay: '{неделя}, {день}',

  until: '{время} кадәр',
  untilTomorrow: 'иртәгә {время} кадәр',
  untilDay: '{день}, {время} кадәр',

  'minutes.one': '{сколько} минут',
  'minutes.few': '{сколько} минут',
  'minutes.many': '{сколько} минут',
  'hours.one': '{сколько} сәгать',
  'hours.few': '{сколько} сәгать',
  'hours.many': '{сколько} сәгать',
  'days.one': '{сколько} көн',
  'days.few': '{сколько} көн',
  'days.many': '{сколько} көн',
  'months.one': '{сколько} ай',
  'months.few': '{сколько} ай',
  'months.many': '{сколько} ай',
  'years.one': '{сколько} ел',
  'years.few': '{сколько} ел',
  'years.many': '{сколько} ел',

  hoursValue: '{сколько} сәг',
};
