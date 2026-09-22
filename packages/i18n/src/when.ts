import type { Translate } from './translate.js';

/**
 * Даты, промежутки и числа на языке человека. Названия месяцев и слова о сроке
 * берутся из словаря, порядок частей задаёт сам язык строкой с подстановками,
 * а разделитель дробной части даёт тег языка из ключа `when.locale`.
 */

const TAG = /^[a-z]{2}(-[A-Za-z]{2,4})?$/u;

/**
 * Тег языка для Intl: по нему разделяются разряды и дробная часть. Перевод,
 * до словаря которого ключ не дошёл, возвращает сам ключ, и тогда остаётся
 * русский: несостоявшийся перевод не должен ронять показ числа.
 */
export const localeOf = (t: Translate): string => {
  const tag = t('when.locale');

  return TAG.test(tag) ? tag : 'ru-RU';
};

/** Форма слова при числе. Словарь языка без трёх форм кладёт во все три одну строку. */
export type Form = 'one' | 'few' | 'many';

const FORMS: Readonly<Record<string, Form>> = {
  zero: 'many',
  one: 'one',
  two: 'few',
  few: 'few',
  many: 'many',
  other: 'many',
};

/** Форма по правилам самого языка, а не по русским. */
export const formOf = (t: Translate, count: number): Form =>
  FORMS[new Intl.PluralRules(localeOf(t)).select(count)] ?? 'many';

/** Число со словом в нужной форме: «2 часа», «2 hours». */
export const counted = (t: Translate, prefix: string, count: number): string =>
  t(`${prefix}.${formOf(t, count)}`, { сколько: count });

/**
 * Разделители разрядов и дробной части. Берутся из словаря, а не из Intl:
 * данных о татарском, киргизском, грузинском и ещё пяти языках продукта в
 * вебвью может не быть вовсе, и тогда Intl молча переходит на английский.
 * Житель, выбравший татарский, видел «6,062.04» вместо «6 062,04».
 */
const separatorsOf = (t: Translate): { group: string; decimal: string } => {
  const group = t('when.group');
  const decimal = t('when.decimal');

  // Неразрывный пробел записан в словаре обычным: в исходнике их не различить.
  return {
    group: group === 'when.group' ? ' ' : group === ' ' ? ' ' : group,
    decimal: decimal === 'when.decimal' ? ',' : decimal,
  };
};

/**
 * Число с разделителями своего языка. Разряды считает Intl по английскому
 * тегу: он есть везде и делит по три всюду, где продукт говорит. Знаки
 * подставляются уже свои.
 */
export const numberIn = (t: Translate, value: number, options?: Intl.NumberFormatOptions): string => {
  const shown = value.toLocaleString('en-US', options);
  const { group, decimal } = separatorsOf(t);

  // Оба знака меняются за один проход: подстановка по очереди переписала бы
  // уже подставленное там, где у языка разделители поменяны местами.
  return shown.replace(/[.,]/gu, (sign) => (sign === ',' ? group : decimal));
};

/** Календарные числа дня. */
export interface DateParts {
  day: number;
  month: number;
  year: number;
}

const numberOf = (parts: readonly Intl.DateTimeFormatPart[], type: string): number =>
  Number(parts.find((part) => part.type === type)?.value ?? 0);

/** Год, месяц и день в заданном поясе: на них уже кладутся слова языка. */
export const partsIn = (at: Date, timeZone: string): DateParts => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(at);

  return {
    year: numberOf(parts, 'year'),
    month: numberOf(parts, 'month'),
    day: numberOf(parts, 'day'),
  };
};

/** Понедельник это 1: тем же счётом задаются приёмные окна. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Какой это день недели в поясе дома. Считается по английскому тегу: он есть
 * в любом вебвью, а само название берётся из словаря.
 */
export const weekdayOf = (at: Date, timeZone: string): number => {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);

  return WEEKDAYS.indexOf(short) + 1;
};

/**
 * День недели словом языка: «четверг», «Thursday», «星期四». Название лежит
 * в словаре рядом с месяцами: у Intl данных о части языков продукта нет,
 * и он отдавал «Tuesday» посреди татарской строки.
 */
export const weekdayIn = (t: Translate, at: Date, timeZone: string): string =>
  t(`app.weekday.${weekdayOf(at, timeZone)}`);

/**
 * Месяц в том падеже, в каком язык ставит его в дате: русский в родительном,
 * остальные в именительном. Падеж называет сам словарь ключом `when.monthCase`.
 */
export const monthIn = (t: Translate, month: number): string =>
  t(`app.${t('when.monthCase') === 'name' ? 'month' : 'monthOf'}.${month}`);

/** День и месяц: «18 сентября», «18 September», «9月18日». Порядок задаёт язык. */
export const dayOf = (t: Translate, parts: DateParts, withYear = false): string =>
  t(withYear ? 'when.dayYear' : 'when.day', {
    день: parts.day,
    месяц: monthIn(t, parts.month),
    год: parts.year,
  });

/** То же от даты. */
export const dayIn = (t: Translate, at: Date, timeZone: string, withYear = false): string =>
  dayOf(t, partsIn(at, timeZone), withYear);

/** Часы и минуты: сутки считаются до 24 во всех языках продукта. */
export const clockIn = (t: Translate, at: Date, timeZone: string): string =>
  at.toLocaleTimeString(localeOf(t), { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Насколько день отстоит от сегодняшнего: по нему решается, нужна ли дата. */
export const daysApart = (at: Date, now: Date, timeZone: string): number => {
  const when = partsIn(at, timeZone);
  const today = partsIn(now, timeZone);

  return Math.round(
    (Date.UTC(when.year, when.month - 1, when.day) - Date.UTC(today.year, today.month - 1, today.day)) / DAY_MS,
  );
};

/**
 * Промежуток словами: «15 минут», «3 часа», «2 дня», «6 месяцев». Человек не
 * переводит в уме 355 минут в часы, поэтому крупные промежутки называются
 * крупными единицами, а мелкие подробности отбрасываются.
 */
export const spanIn = (t: Translate, minutes: number): string => {
  if (minutes < 60) return counted(t, 'when.minutes', minutes);

  const hours = Math.round(minutes / 60);

  if (hours < 24) return counted(t, 'when.hours', hours);

  const whole = Math.round(minutes / (24 * 60));

  if (whole < 31) return counted(t, 'when.days', whole);

  const months = Math.round(whole / 30);

  if (months < 12) return counted(t, 'when.months', months);

  return counted(t, 'when.years', Math.round(months / 12));
};
