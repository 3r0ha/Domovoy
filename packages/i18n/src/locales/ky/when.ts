import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'ky-KG',
  monthCase: 'name',

  day: '{день}-{месяц}',
  dayYear: '{год}-жылдын {день}-{месяц}',
  at: '{день}, саат {время}',
  weekdayDay: '{неделя}, {день}',

  until: 'саат {время}-ке чейин',
  untilTomorrow: 'эртең саат {время}-ке чейин',
  untilDay: '{день}, саат {время}-ке чейин',

  'minutes.one': '{сколько} мүнөт',
  'minutes.few': '{сколько} мүнөт',
  'minutes.many': '{сколько} мүнөт',
  'hours.one': '{сколько} саат',
  'hours.few': '{сколько} саат',
  'hours.many': '{сколько} саат',
  'days.one': '{сколько} күн',
  'days.few': '{сколько} күн',
  'days.many': '{сколько} күн',
  'months.one': '{сколько} ай',
  'months.few': '{сколько} ай',
  'months.many': '{сколько} ай',
  'years.one': '{сколько} жыл',
  'years.few': '{сколько} жыл',
  'years.many': '{сколько} жыл',

  hoursValue: '{сколько} саат',
};
