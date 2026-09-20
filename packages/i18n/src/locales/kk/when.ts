import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'kk-KZ',
  monthCase: 'name',

  day: '{день} {месяц}',
  dayYear: '{год} жылғы {день} {месяц}',
  at: '{день}, сағат {время}',
  weekdayDay: '{неделя}, {день}',

  until: 'сағат {время}-ге дейін',
  untilTomorrow: 'ертең сағат {время}-ге дейін',
  untilDay: '{день}, сағат {время}-ге дейін',

  'minutes.one': '{сколько} минут',
  'minutes.few': '{сколько} минут',
  'minutes.many': '{сколько} минут',
  'hours.one': '{сколько} сағат',
  'hours.few': '{сколько} сағат',
  'hours.many': '{сколько} сағат',
  'days.one': '{сколько} күн',
  'days.few': '{сколько} күн',
  'days.many': '{сколько} күн',
  'months.one': '{сколько} ай',
  'months.few': '{сколько} ай',
  'months.many': '{сколько} ай',
  'years.one': '{сколько} жыл',
  'years.few': '{сколько} жыл',
  'years.many': '{сколько} жыл',

  hoursValue: '{сколько} сағ',
};
