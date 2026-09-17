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
  accepted: 'Принять',
  in_progress: 'В работу',
  needs_info: 'Уточнить',
  done: 'Выполнена',
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

/** Сколько осталось, без глагола. */
export const formatLeft = (isoDate: string, now: Date = new Date()): string =>
  spanWords(minutesBetween(now.getTime(), new Date(isoDate).getTime()));

/** Номер не отрывается от слова: «подъезд 1» переносится целиком. */
export const tight = (text: string): string => text.replace(/ (\d)/g, '\u00a0$1');

/** Сколько прошло, теми же словами. */
export const formatSince = (isoDate: string, now: Date = new Date()): string =>
  spanWords(minutesBetween(new Date(isoDate).getTime(), now.getTime()));

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
  const due = new Date(isoDate);
  const diffMinutes = Math.round((due.getTime() - now.getTime()) / 60_000);

  if (diffMinutes < 0) {
    const overdue = Math.abs(diffMinutes);
    return overdue < 60 ? `просрочено на ${overdue} мин` : `просрочено на ${Math.round(overdue / 60)} ч`;
  }

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
