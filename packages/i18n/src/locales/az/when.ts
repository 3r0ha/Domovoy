import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'az-AZ',
  monthCase: 'name',

  day: '{день} {месяц}',
  dayYear: '{день} {месяц} {год}',
  at: '{день}, saat {время}',
  weekdayDay: '{неделя}, {день}',

  until: 'saat {время}-dək',
  untilTomorrow: 'sabah saat {время}-dək',
  untilDay: '{день}, saat {время}-dək',

  'minutes.one': '{сколько} dəqiqə',
  'minutes.few': '{сколько} dəqiqə',
  'minutes.many': '{сколько} dəqiqə',
  'hours.one': '{сколько} saat',
  'hours.few': '{сколько} saat',
  'hours.many': '{сколько} saat',
  'days.one': '{сколько} gün',
  'days.few': '{сколько} gün',
  'days.many': '{сколько} gün',
  'months.one': '{сколько} ay',
  'months.few': '{сколько} ay',
  'months.many': '{сколько} ay',
  'years.one': '{сколько} il',
  'years.few': '{сколько} il',
  'years.many': '{сколько} il',

  hoursValue: '{сколько} saat',
};
