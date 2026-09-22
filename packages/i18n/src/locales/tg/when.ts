import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'tg-TJ',
  group: ' ',
  decimal: ',',
  monthCase: 'name',

  day: '{день} {месяц}',
  dayYear: '{день} {месяц}и соли {год}',
  at: '{день}, соати {время}',
  weekdayDay: '{неделя}, {день}',

  until: 'то соати {время}',
  untilTomorrow: 'пагоҳ то соати {время}',
  untilDay: 'то {день}, соати {время}',

  'minutes.one': '{сколько} дақиқа',
  'minutes.few': '{сколько} дақиқа',
  'minutes.many': '{сколько} дақиқа',
  'hours.one': '{сколько} соат',
  'hours.few': '{сколько} соат',
  'hours.many': '{сколько} соат',
  'days.one': '{сколько} рӯз',
  'days.few': '{сколько} рӯз',
  'days.many': '{сколько} рӯз',
  'months.one': '{сколько} моҳ',
  'months.few': '{сколько} моҳ',
  'months.many': '{сколько} моҳ',
  'years.one': '{сколько} сол',
  'years.few': '{сколько} сол',
  'years.many': '{сколько} сол',

  hoursValue: '{сколько} соат',
};
