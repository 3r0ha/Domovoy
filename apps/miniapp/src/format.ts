/** Числа, сроки и даты по-русски. */

const STATUS_TITLES: Record<string, string> = {
  new: 'Отправлена',
  accepted: 'Принята в работу',
  in_progress: 'Выполняется',
  needs_info: 'Ждёт вашего уточнения',
  done: 'Ждёт вашей приёмки',
  confirmed: 'Закрыта, работа принята',
  rejected: 'Отклонена',
  withdrawn: 'Снята',
};

/** Те же состояния глазами управляющей компании. */
const STAFF_STATUS_TITLES: Record<string, string> = {
  new: 'Новая',
  accepted: 'Принята, ждёт назначения',
  needs_info: 'Ждёт уточнения от жильца',
  done: 'Ждёт приёмки жильцом',
  withdrawn: 'Снята жильцом',
};

export const statusTitle = (status: string, staff = false): string =>
  (staff ? STAFF_STATUS_TITLES[status] : undefined) ?? STATUS_TITLES[status] ?? status;

const ACTION_TITLES: Record<string, string> = {
  accepted: 'Взять',
  in_progress: 'В работу',
  needs_info: 'Уточнить',
  done: 'Сдать работу',
  confirmed: 'Принять работу',
  rejected: 'Отклонить',
  withdrawn: 'Снять',
};

export const actionTitle = (action: string): string => ACTION_TITLES[action] ?? action;

/** Срок в человеческом виде. */
const spanWords = (minutes: number): string => {
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} ч`;

  const days = Math.round(minutes / (60 * 24));
  const tail = days % 100;
  const last = days % 10;

  if (tail >= 11 && tail <= 14) return `${days} дней`;
  if (last === 1) return `${days} день`;
  if (last >= 2 && last <= 4) return `${days} дня`;

  return `${days} дней`;
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

/** Число со словом в нужном падеже: «2 соседа», «5 соседей». */
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

  if (diffMinutes < 0) return `просрочено ${spanWords(Math.abs(diffMinutes))}`;

  const left = formatLeft(isoDate, now);
  const count = Number.parseInt(left, 10);
  const tail = count % 100;
  const single = !(tail >= 11 && tail <= 14) && count % 10 === 1;
  const verb = !single ? 'осталось' : left.endsWith('мин') ? 'осталась' : 'остался';

  return `${verb} ${left}`;
};

/** Когда объявление появилось. */
export const formatPublished = (isoDate: string): string =>
  new Date(isoDate).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Часы и минуты: гостевой код живёт минуты, и «через 15 мин» стареет на глазах. */
export const formatTime = (isoDate: string): string =>
  new Date(isoDate).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/** Название месяца по его номеру от нуля. */
export const monthName = (index: number): string => MONTHS[index] ?? '';

/** Месяц тремя буквами: подпись под столбиком графика. */
export const monthShort = (index: number): string => monthName(index).slice(0, 3);

/** Сумма без знака валюты: «1 234,50». */
export const money = (amount: number): string =>
  amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Сумма со знаком рубля. */
export const rubles = (amount: number): string => `${money(amount)} ₽`;

/** Дробная часть через запятую: «137,1». */
export const decimal = (value: number, digits = 3): string =>
  value.toLocaleString('ru-RU', { maximumFractionDigits: digits });

/** Первая буква имени: её показывает кружок вместо снимка. */
export const initial = (name: string): string => name.trim().slice(0, 1).toUpperCase() || '?';

/** Дата без времени. */
export const formatDay = (isoDate: string, now: Date = new Date()): string => {
  const date = new Date(isoDate);
  const sameYear = date.getFullYear() === now.getFullYear();

  return date.toLocaleDateString('ru-RU', {
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

  const clock = due.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((midnight(due) - midnight(now)) / DAY_MS);

  if (days === 0) return `сегодня в ${clock}`;
  if (days === 1) return `завтра в ${clock}`;
  if (days === -1) return `вчера в ${clock}`;

  return `${formatDay(isoDate, now)} в ${clock}`;
};
