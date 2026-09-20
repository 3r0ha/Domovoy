/** Числа, сроки и даты на языке человека. */

import { translatorFor, type Translate } from '@domovoy/i18n';

import { say, spokenLanguage } from './i18n.js';

/** Состояния, которые продукт называет сам. Чужое приходит с сервера как есть. */
const STATUSES = ['new', 'accepted', 'in_progress', 'needs_info', 'done', 'confirmed', 'rejected', 'withdrawn'];

/** Те же состояния глазами управляющей компании. Смена работает по-русски. */
const STAFF_STATUS_TITLES: Record<string, string> = {
  new: 'Новая',
  accepted: 'Принята, ждёт назначения',
  needs_info: 'Ждёт уточнения от жильца',
  done: 'Ждёт приёмки жильцом',
  withdrawn: 'Снята жильцом',
};

/** Состояние словами смотрящего. `sent`, как его назвал сервер. */
export const statusTitle = (status: string, staff = false, sent?: string): string => {
  if (!STATUSES.includes(status)) return sent ?? status;

  return (staff ? STAFF_STATUS_TITLES[status] : undefined) ?? say(`status.${status}`);
};

/** Те же слова, что на кнопках бота: одно действие называется одинаково везде. */
export const actionTitle = (action: string): string => say(`action.${action}`);

/** Форма слова по числу: у каждого языка свой набор форм. */
const form = (count: number): string => new Intl.PluralRules(spokenLanguage()).select(count);

/** Число со словом в нужной форме: ключ хранит все формы языка. */
export const counted = (key: string, count: number): string => say(`${key}.${form(count)}`, { число: count });

/** Срок числом и единицей: по единице выбирается и глагол рядом с ней. */
const spanOf = (minutes: number): { unit: 'min' | 'hour' | 'day'; count: number } => {
  if (minutes < 60) return { unit: 'min', count: minutes };

  const hours = Math.round(minutes / 60);

  // Округлившееся до суток считается днём: «24 ч» никто в уме не переводит.
  if (hours < 24) return { unit: 'hour', count: hours };

  return { unit: 'day', count: Math.round(minutes / (60 * 24)) };
};

/** Срок в человеческом виде. */
const spanWords = (minutes: number): string => {
  const { unit, count } = spanOf(minutes);

  return unit === 'day' ? counted('count.day', count) : say(`span.${unit}`, { число: count });
};

const minutesBetween = (from: number, to: number): number => Math.max(0, Math.round((to - from) / 60_000));

/** Время из строки. NaN означает, что разобрать не удалось. */
const at = (isoDate: string): number => new Date(isoDate).getTime();

/** Сколько осталось, без глагола. Пусто, если срок не разобран. */
export const formatLeft = (isoDate: string, now: Date = new Date()): string => {
  const due = at(isoDate);

  return Number.isNaN(due) ? '' : spanWords(minutesBetween(now.getTime(), due));
};

/** Номер не отрывается от слова: «подъезд 1» переносится целиком. */
export const tight = (text: string): string => text.replace(/ (\d)/g, '\u00a0$1');

/** Сколько прошло, теми же словами. */
export const formatSince = (isoDate: string, now: Date = new Date()): string => {
  const was = at(isoDate);

  return Number.isNaN(was) ? '' : spanWords(minutesBetween(was, now.getTime()));
};

/** Число со словом в нужном падеже по-русски: слова смены не переводятся. */
export const plural = (count: number, one: string, few: string, many: string): string => {
  const tail = count % 100;
  const last = count % 10;

  if (tail >= 11 && tail <= 14) return `${count} ${many}`;
  if (last === 1) return `${count} ${one}`;
  if (last >= 2 && last <= 4) return `${count} ${few}`;

  return `${count} ${many}`;
};

/** Срок в человеческом виде. */
export const formatDeadline = (isoDate: string, now: Date = new Date()): string => {
  const due = at(isoDate);

  if (Number.isNaN(due)) return '';

  const diffMinutes = Math.round((due - now.getTime()) / 60_000);

  if (diffMinutes < 0) return say('deadline.overdue', { срок: spanWords(Math.abs(diffMinutes)) });

  const minutes = minutesBetween(now.getTime(), due);
  const { unit, count } = spanOf(minutes);
  // Глагол согласуется с единицей срока: «осталась 21 мин», но «остался 21 день».
  const key = form(count) !== 'one' ? 'deadline.left' : unit === 'min' ? 'deadline.left.minute' : 'deadline.left.one';

  return say(key, { срок: spanWords(minutes) });
};

/** Часы и минуты: гостевой код живёт минуты, и «через 15 мин» стареет на глазах. */
export const formatTime = (isoDate: string): string =>
  new Date(isoDate).toLocaleTimeString(spokenLanguage(), { hour: '2-digit', minute: '2-digit' });

const MONTHS = 12;

/** Название месяца по его номеру от нуля. */
export const monthName = (index: number): string =>
  index >= 0 && index < MONTHS ? say(`month.${index + 1}`) : '';

/** Месяц тремя буквами: подпись под столбиком графика. */
export const monthShort = (index: number): string => monthName(index).slice(0, 3);

/** Перевод без приставки области: даты, единицы и разделители лежат в разделе `when`. */
const when: Translate = (key, values) => translatorFor(spokenLanguage())(key, values);

/** Сумма без знака валюты: «1 234,50», «1,234.50». Валюта остаётся рублём. */
export const money = (amount: number): string =>
  amount.toLocaleString(when('when.locale'), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Сумма со знаком рубля. */
export const rubles = (amount: number): string => `${money(amount)} ₽`;

/** Дробная часть с разделителем своего языка: «137,1», «137.1». */
export const decimal = (value: number, digits = 3): string =>
  value.toLocaleString(when('when.locale'), { maximumFractionDigits: digits });

/** Часы с долей: «14,8 ч». */
export const hours = (value: number): string => when('when.hoursValue', { сколько: decimal(value, 1) });

/** Российский номер по группам: «+7 999 000-00-00». Чужой формат остаётся как есть. */
export const formatPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  const local = digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8')) ? digits.slice(1) : null;

  if (local === null) return phone;

  return `+7 ${local.slice(0, 3)} ${local.slice(3, 6)}-${local.slice(6, 8)}-${local.slice(8)}`;
};

/** Первая буква имени: её показывает кружок вместо снимка. */
export const initial = (name: string): string => name.trim().slice(0, 1).toUpperCase() || '?';

/** Дата без времени. */
export const formatDay = (isoDate: string, now: Date = new Date()): string => {
  const date = new Date(isoDate);
  const sameYear = date.getFullYear() === now.getFullYear();

  return date.toLocaleDateString(spokenLanguage(), {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

/** Полночь этого дня: по ней считается, сегодня срок или завтра. */
const midnight = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Когда наступит срок: день и час. Сегодняшний и завтрашний названы словом. */
export const formatDue = (isoDate: string, now: Date = new Date()): string => {
  const due = new Date(isoDate);

  if (Number.isNaN(due.getTime())) return '';

  const clock = formatTime(isoDate);
  const days = Math.round((midnight(due) - midnight(now)) / DAY_MS);

  if (days === 0) return say('due.today', { время: clock });
  if (days === 1) return say('due.tomorrow', { время: clock });
  if (days === -1) return say('due.yesterday', { время: clock });

  return say('due.on', { дата: formatDay(isoDate, now), время: clock });
};

/**
 * Когда сказанное появилось: тот же день и час, что у срока. Прошлогодняя
 * переписка без года выглядит свежей, а вчерашняя строка читается словом.
 */
export const formatPublished = (isoDate: string, now: Date = new Date()): string => formatDue(isoDate, now);

/** Целое число из поля ввода в заданных пределах. Пусто и мусор дают пусто. */
export const parseCount = (value: string, least: number, most: number): number | null => {
  const parsed = parseDecimal(value);

  if (parsed === null || !Number.isInteger(parsed) || parsed < least || parsed > most) return null;

  return parsed;
};

/** Число из поля ввода: пустое поле числом не считается, запятая это точка. */
export const parseDecimal = (value: string): number | null => {
  const text = value.trim().replaceAll(',', '.');

  if (text.length === 0) return null;

  const parsed = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
};
