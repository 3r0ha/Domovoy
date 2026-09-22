import type { Translate } from '@domovoy/i18n';

import { russian } from './moment.js';
import { DomainError, DEFAULT_TIME_ZONE } from './types.js';

/**
 * Запись на приём в управляющую организацию. Порядок информационного
 * взаимодействия (приказ Минстроя России № 856/пр) требует, чтобы записаться
 * на приём можно было через MAX, поэтому приёмные окна и записи ведёт продукт.
 */

/** Приёмное окно: день недели и время с точностью до минуты. */
export interface ReceptionWindow {
  /** День недели: 1 понедельник, 7 воскресенье. */
  weekday: number;
  /** Начало приёма, «15:00». */
  from: string;
  /** Конец приёма, «19:00». */
  to: string;
}

export type VisitStatus = 'booked' | 'cancelled' | 'done';

export interface Visit {
  id: string;
  buildingId: string;
  residentId: string;
  /** Начало приёма. */
  at: Date;
  /** Сколько минут занимает приём. */
  minutes: number;
  /** С чем человек придёт. */
  topic: string;
  status: VisitStatus;
  createdAt: Date;
}

/** Сколько минут длится приём по умолчанию. */
export const VISIT_MINUTES = 30;

/** На сколько дней вперёд показываются свободные часы. */
export const RECEPTION_HORIZON_DAYS = 14;

/** Сколько знаков помещается в тему приёма. */
export const TOPIC_MAX_LENGTH = 200;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3600_000;

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Название дня недели по-русски: для журнала и документов, где языка нет. */
export const WEEKDAY_TITLES = [1, 2, 3, 4, 5, 6, 7].map((weekday) => russian(`app.weekday.${weekday}`));

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 1 понедельник, 7 воскресенье. */
  weekday: number;
}

/** Форматтер стоит дорого, а сетка приёма зовёт его на каждый слот. */
const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const known = formatters.get(timeZone);

  if (known) return known;

  const created = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });

  formatters.set(timeZone, created);

  return created;
};

/** Местные части момента в часовом поясе дома. */
export const partsIn = (at: Date, timeZone: string = DEFAULT_TIME_ZONE): LocalParts => {
  const parts = formatterFor(timeZone).formatToParts(at);

  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = WEEKDAYS.indexOf(value('weekday').toLowerCase().slice(0, 3)) + 1;

  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    // Полночь Intl отдаёт как «24», а это ноль часов следующих суток.
    hour: Number(value('hour')) % 24,
    minute: Number(value('minute')),
    weekday: weekday === 0 ? 1 : weekday,
  };
};

/** Сдвиг часового пояса в этот момент, миллисекунды. */
const offsetIn = (at: Date, timeZone: string): number => {
  const local = partsIn(at, timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);

  return asUtc - Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS;
};

/**
 * Момент, в который в этом поясе наступит указанное местное время. Второй
 * проход нужен там, где переводят часы: сдвиг до и после перевода разный.
 */
export const momentIn = (
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string = DEFAULT_TIME_ZONE,
): Date => {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const rough = new Date(asUtc - offsetIn(new Date(asUtc), timeZone));

  return new Date(asUtc - offsetIn(rough, timeZone));
};

/** Время «15:00» в минутах от полуночи. Пусто, если запись не похожа на время. */
export const minutesOfDay = (time: string): number | undefined => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());

  if (!match) return undefined;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) return undefined;

  return hour * 60 + minute;
};

/** Приёмные окна из карточки дома. @throws {DomainError} если окно задано неверно. */
export const checkReception = (windows: readonly ReceptionWindow[]): ReceptionWindow[] =>
  windows.map((window) => {
    const from = minutesOfDay(window.from);
    const to = minutesOfDay(window.to);

    if (!Number.isInteger(window.weekday) || window.weekday < 1 || window.weekday > 7) {
      throw new DomainError('reception_invalid', 'День недели задаётся числом от 1 до 7');
    }

    if (from === undefined || to === undefined) {
      throw new DomainError('reception_invalid', 'Время приёма задаётся как «15:00»');
    }

    if (to <= from) throw new DomainError('reception_invalid', 'Приём заканчивается позже, чем начинается');

    return { weekday: window.weekday, from: window.from.trim(), to: window.to.trim() };
  });

export interface SlotsInput {
  windows: readonly ReceptionWindow[];
  /** Длительность приёма. */
  minutes?: number;
  /** С какого момента считать: обычно «сейчас». */
  from: Date;
  /** На сколько дней вперёд. */
  days?: number;
  /** Занятое время: эти часы в список не попадают. */
  taken?: readonly Date[];
  timeZone?: string;
}

/** Свободные часы приёма по порядку. */
export const receptionSlots = ({
  windows,
  minutes = VISIT_MINUTES,
  from,
  days = RECEPTION_HORIZON_DAYS,
  taken = [],
  timeZone = DEFAULT_TIME_ZONE,
}: SlotsInput): Date[] => {
  if (windows.length === 0 || minutes <= 0) return [];

  const busy = new Set(taken.map((at) => at.getTime()));
  const slots: Date[] = [];

  for (let shift = 0; shift < days; shift += 1) {
    const local = partsIn(new Date(from.getTime() + shift * DAY_MS), timeZone);

    for (const window of windows) {
      if (window.weekday !== local.weekday) continue;

      const opens = minutesOfDay(window.from);
      const closes = minutesOfDay(window.to);

      if (opens === undefined || closes === undefined) continue;

      for (let time = opens; time + minutes <= closes; time += minutes) {
        const at = momentIn(
          { year: local.year, month: local.month, day: local.day, hour: Math.floor(time / 60), minute: time % 60 },
          timeZone,
        );

        if (at.getTime() <= from.getTime() || busy.has(at.getTime())) continue;

        slots.push(at);
      }
    }
  }

  return slots.sort((left, right) => left.getTime() - right.getTime());
};

/** Запись действует: её ещё не отменили и приём не прошёл. */
export const isActiveVisit = (visit: Visit, now: Date): boolean =>
  visit.status === 'booked' && visit.at.getTime() + visit.minutes * MINUTE_MS > now.getTime();

export interface BookVisitInput {
  id: string;
  buildingId: string;
  residentId: string;
  at: Date;
  minutes?: number;
  topic: string;
  now: Date;
  /** Свободные часы: запись принимается только на одно из них. */
  slots: readonly Date[];
}

/** С чем пришли: тема записи. @throws {DomainError} */
const checkTopic = (given: string): string => {
  const topic = given.trim();

  if (topic.length === 0) throw new DomainError('topic_empty', 'Напишите, с чем придёте');
  if (topic.length > TOPIC_MAX_LENGTH) {
    throw new DomainError('topic_too_long', `Тема длиннее ${TOPIC_MAX_LENGTH} знаков`);
  }

  return topic;
};

/** Новая запись на приём. @throws {DomainError} */
export const bookVisit = (input: BookVisitInput): Visit => {
  const topic = checkTopic(input.topic);

  if (!input.slots.some((slot) => slot.getTime() === input.at.getTime())) {
    throw new DomainError('slot_taken', 'Это время уже занято или приём в него не ведётся');
  }

  return {
    id: input.id,
    buildingId: input.buildingId,
    residentId: input.residentId,
    at: input.at,
    minutes: input.minutes ?? VISIT_MINUTES,
    topic,
    status: 'booked',
    createdAt: input.now,
  };
};

export interface WriteVisitInput {
  id: string;
  buildingId: string;
  residentId: string;
  /** Когда пришли или придут. */
  at: Date;
  minutes?: number;
  topic: string;
  now: Date;
}

/**
 * Запись, которую делает сотрудник. Приёмные часы не проверяются: пришедшего
 * без записи записывают тем временем, когда он пришёл. Прошедшее время
 * означает, что приём уже состоялся. @throws {DomainError}
 */
export const writeVisit = (input: WriteVisitInput): Visit => ({
  id: input.id,
  buildingId: input.buildingId,
  residentId: input.residentId,
  at: input.at,
  minutes: input.minutes ?? VISIT_MINUTES,
  topic: checkTopic(input.topic),
  status: input.at.getTime() > input.now.getTime() ? 'booked' : 'done',
  createdAt: input.now,
});

/** Границы длительности приёма. */
export const VISIT_MINUTES_RANGE = { min: 5, max: 240 } as const;

/** Сколько длится один приём. @throws {DomainError} */
export const checkVisitMinutes = (minutes: number): number => {
  if (!Number.isInteger(minutes) || minutes < VISIT_MINUTES_RANGE.min || minutes > VISIT_MINUTES_RANGE.max) {
    throw new DomainError(
      'reception_invalid',
      `Приём длится от ${VISIT_MINUTES_RANGE.min} до ${VISIT_MINUTES_RANGE.max} минут`,
    );
  }

  return minutes;
};

/** Запись отменена: время снова свободно. */
export const cancelVisit = (visit: Visit, now: Date): Visit => {
  if (visit.status !== 'booked') throw new DomainError('visit_closed', 'Эта запись уже закрыта');
  if (visit.at.getTime() <= now.getTime()) throw new DomainError('visit_started', 'Приём уже начался');

  return { ...visit, status: 'cancelled' };
};

/** Приём состоялся: отмечает смена. */
export const completeVisit = (visit: Visit): Visit =>
  visit.status === 'booked' ? { ...visit, status: 'done' } : visit;

/**
 * Приёмные окна словами: «вторник 15:00-19:00, четверг 15:00-19:00». День
 * недели называет язык человека: строка идёт жильцу, а не в журнал.
 */
export const formatReception = (windows: readonly ReceptionWindow[], t: Translate = russian): string =>
  windows
    .slice()
    .sort((left, right) => left.weekday - right.weekday)
    .map((window) => `${t(`app.weekday.${window.weekday}`)} ${window.from}-${window.to}`)
    .join(', ');
