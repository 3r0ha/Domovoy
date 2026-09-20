import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'ru-RU',
  monthCase: 'of',

  day: '{день} {месяц}',
  dayYear: '{день} {месяц} {год} г.',
  at: '{день} в {время}',
  weekdayDay: '{неделя}, {день}',

  until: 'до {время}',
  untilTomorrow: 'до {время} завтра',
  untilDay: 'до {день}, {время}',

  'minutes.one': '{сколько} минуту',
  'minutes.few': '{сколько} минуты',
  'minutes.many': '{сколько} минут',
  'hours.one': '{сколько} час',
  'hours.few': '{сколько} часа',
  'hours.many': '{сколько} часов',
  'days.one': '{сколько} день',
  'days.few': '{сколько} дня',
  'days.many': '{сколько} дней',
  'months.one': '{сколько} месяц',
  'months.few': '{сколько} месяца',
  'months.many': '{сколько} месяцев',
  'years.one': '{сколько} год',
  'years.few': '{сколько} года',
  'years.many': '{сколько} лет',

  hoursValue: '{сколько} ч',
};
