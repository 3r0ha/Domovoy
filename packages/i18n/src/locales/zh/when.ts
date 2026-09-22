import type { Dictionary } from '../../translate.js';

/** Даты, сроки и числа. Порядок частей и разделители задаёт сам язык. */
export const when: Dictionary = {
  locale: 'zh-CN',
  group: ',',
  decimal: '.',
  monthCase: 'name',

  day: '{месяц}{день}日',
  dayYear: '{год}年{месяц}{день}日',
  at: '{день} {время}',
  weekdayDay: '{неделя}，{день}',

  until: '截至{время}',
  untilTomorrow: '截至明天{время}',
  untilDay: '截至{день} {время}',

  'minutes.one': '{сколько}分钟',
  'minutes.few': '{сколько}分钟',
  'minutes.many': '{сколько}分钟',
  'hours.one': '{сколько}小时',
  'hours.few': '{сколько}小时',
  'hours.many': '{сколько}小时',
  'days.one': '{сколько}天',
  'days.few': '{сколько}天',
  'days.many': '{сколько}天',
  'months.one': '{сколько}个月',
  'months.few': '{сколько}个月',
  'months.many': '{сколько}个月',
  'years.one': '{сколько}年',
  'years.few': '{сколько}年',
  'years.many': '{сколько}年',

  hoursValue: '{сколько}小时',
};
