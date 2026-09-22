import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'ro-RO',
  group: '.',
  decimal: ',',
  monthCase: 'name',

  day: '{день} {месяц}',
  dayYear: '{день} {месяц} {год}',
  at: '{день}, ora {время}',
  weekdayDay: '{неделя}, {день}',

  until: 'până la ora {время}',
  untilTomorrow: 'mâine până la ora {время}',
  untilDay: 'până la {день}, ora {время}',

  'minutes.one': '{сколько} minut',
  'minutes.few': '{сколько} minute',
  'minutes.many': '{сколько} de minute',
  'hours.one': '{сколько} oră',
  'hours.few': '{сколько} ore',
  'hours.many': '{сколько} de ore',
  'days.one': '{сколько} zi',
  'days.few': '{сколько} zile',
  'days.many': '{сколько} de zile',
  'months.one': '{сколько} lună',
  'months.few': '{сколько} luni',
  'months.many': '{сколько} de luni',
  'years.one': '{сколько} an',
  'years.few': '{сколько} ani',
  'years.many': '{сколько} de ani',

  hoursValue: '{сколько} h',
};
