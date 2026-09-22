import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'hy-AM',
  group: ' ',
  decimal: ',',
  monthCase: 'name',

  day: '{месяц}ի {день}',
  dayYear: '{год} թ. {месяц}ի {день}',
  at: '{день}, ժամը {время}',
  weekdayDay: '{неделя}, {день}',

  until: 'մինչև ժամը {время}',
  untilTomorrow: 'վաղը մինչև ժամը {время}',
  untilDay: 'մինչև {день}, ժամը {время}',

  'minutes.one': '{сколько} րոպե',
  'minutes.few': '{сколько} րոպե',
  'minutes.many': '{сколько} րոպե',
  'hours.one': '{сколько} ժամ',
  'hours.few': '{сколько} ժամ',
  'hours.many': '{сколько} ժամ',
  'days.one': '{сколько} օր',
  'days.few': '{сколько} օր',
  'days.many': '{сколько} օր',
  'months.one': '{сколько} ամիս',
  'months.few': '{сколько} ամիս',
  'months.many': '{сколько} ամիս',
  'years.one': '{сколько} տարի',
  'years.few': '{сколько} տարի',
  'years.many': '{сколько} տարի',

  hoursValue: '{сколько} ժ',
};
