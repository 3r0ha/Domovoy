import { partsIn, momentIn } from './reception.js';
import { DomainError, type Appointment, type ServiceRequest } from './types.js';

export type { Appointment };

/**
 * Согласование визита в квартиру. Работы в квартире требуют, чтобы дома кто-то
 * был, поэтому мастер предлагает окна, жилец выбирает одно, а неудачный выезд
 * записывается и двигает срок: за закрытую дверь отвечает не компания.
 */

/** Сколько длится окно визита, минуты. */
export const VISIT_WINDOW_MINUTES = 240;

/** Во сколько начинаются окна: утро и день. */
export const VISIT_WINDOW_HOURS = [9, 14];

/** На сколько дней вперёд предлагаются окна. */
export const VISIT_WINDOW_DAYS = 3;

/** На сколько часов сдвигается срок после неудачного выезда. */
export const MISSED_VISIT_GRACE_HOURS = 24;

/** Сколько раз подряд мастер отмечает, что не попал в квартиру. */
export const MISSED_VISIT_LIMIT = 3;

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** Нужен ли для работ доступ в квартиру: общее имущество открывают без жильца. */
export const needsAccess = (request: ServiceRequest): boolean => request.target.kind === 'apartment';

/**
 * Окна для выбора: по два на день. Сегодняшнее окно предлагается, только пока
 * оно не началось, иначе жилец выбирает время, которое уже прошло.
 */
export const visitWindows = (from: Date, timeZone?: string, days = VISIT_WINDOW_DAYS): Date[] => {
  const slots: Date[] = [];
  const wanted = days * VISIT_WINDOW_HOURS.length;

  for (let day = 0; day <= days && slots.length < wanted; day += 1) {
    const { year, month, day: date } = partsIn(new Date(from.getTime() + day * DAY_MS), timeZone);

    for (const hour of VISIT_WINDOW_HOURS) {
      const start = momentIn({ year, month, day: date, hour, minute: 0 }, timeZone);

      // До начала окна должен остаться хотя бы час: мастер не выезжает
      // по заявке, время которой выбрали за минуту до него.
      if (start.getTime() - from.getTime() < HOUR_MS) continue;

      slots.push(start);
    }
  }

  return slots.slice(0, wanted);
};

export interface OfferVisitInput {
  slots: readonly Date[];
  actorId: string;
  at: Date;
  minutes?: number;
}

/** Мастер предлагает жильцу окна визита. @throws {DomainError} */
export const offerVisit = (request: ServiceRequest, input: OfferVisitInput): ServiceRequest => {
  if (!needsAccess(request)) {
    throw new DomainError('visit_not_needed', 'Для работ по общему имуществу доступ в квартиру не нужен');
  }

  const ahead = input.slots.filter((slot) => slot.getTime() > input.at.getTime());

  if (ahead.length === 0) {
    throw new DomainError('visit_no_slots', 'Нужно предложить хотя бы одно время впереди');
  }

  return {
    ...request,
    appointment: {
      slots: [...ahead].sort((one, other) => one.getTime() - other.getTime()),
      minutes: input.minutes ?? VISIT_WINDOW_MINUTES,
      offeredAt: input.at,
      missed: request.appointment?.missed ?? [],
    },
  };
};

export interface PickVisitInput {
  at: Date;
  now: Date;
}

/** Сколько времени у компании остаётся на работы после окна визита. */
export const AFTER_VISIT_HOURS = 24;

/**
 * Жилец выбирает одно из предложенных окон. Окна остаются на месте: время
 * переносят тем же списком, пока оно не наступило. Срок выполнения не может
 * истечь раньше визита: до него работы делать некому. @throws {DomainError}
 */
export const pickVisit = (request: ServiceRequest, input: PickVisitInput): ServiceRequest => {
  const offer = request.appointment;

  if (!offer) throw new DomainError('visit_not_offered', 'По этой заявке время ещё не предлагали');

  const chosen = offer.slots.find((slot) => slot.getTime() === input.at.getTime());

  if (!chosen) throw new DomainError('visit_slot_wrong', 'Такого времени среди предложенных нет');

  if (chosen.getTime() <= input.now.getTime()) {
    throw new DomainError('visit_slot_past', 'Это время уже прошло, выберите другое');
  }

  const after = new Date(chosen.getTime() + (offer.minutes + AFTER_VISIT_HOURS * 60) * 60_000);

  return {
    ...request,
    resolutionDueAt: after.getTime() > request.resolutionDueAt.getTime() ? after : request.resolutionDueAt,
    appointment: { ...offer, at: chosen },
  };
};

export interface MissVisitInput {
  at: Date;
  actorId: string;
}

/**
 * Мастер приехал и не попал в квартиру. Выбранное время снимается, срок
 * выполнения сдвигается: закрытая дверь не делает компанию нарушителем.
 * @throws {DomainError}
 */
export const missVisit = (request: ServiceRequest, input: MissVisitInput): ServiceRequest => {
  const offer = request.appointment;

  if (!offer?.at) throw new DomainError('visit_not_set', 'Время визита не согласовано');

  const missed = [...offer.missed, { at: input.at, actorId: input.actorId }];
  const moved = new Date(input.at.getTime() + MISSED_VISIT_GRACE_HOURS * HOUR_MS);

  return {
    ...request,
    resolutionDueAt: moved.getTime() > request.resolutionDueAt.getTime() ? moved : request.resolutionDueAt,
    appointment: { ...offer, slots: [], at: undefined, missed },
  };
};

/**
 * Жилец отменяет выбранное время. Планы меняются, а до сих пор выбранное окно
 * снять было нечем: мастер ехал в пустую квартиру. Окна остаются, и время
 * выбирается заново. @throws {DomainError}
 */
export const dropVisitSlot = (request: ServiceRequest, now: Date): ServiceRequest => {
  const offer = request.appointment;

  if (!offer?.at) throw new DomainError('visit_not_set', 'Время визита не согласовано');

  if (offer.at.getTime() <= now.getTime()) {
    throw new DomainError('visit_slot_past', 'Это время уже наступило, напишите мастеру');
  }

  return { ...request, appointment: { ...offer, at: undefined } };
};

/** Сколько раз мастер не попал в квартиру. */
export const missedVisits = (request: ServiceRequest): number => request.appointment?.missed.length ?? 0;

/** Жилец не пускает мастера: дальше решает управляющая организация. */
export const accessRefused = (request: ServiceRequest): boolean => missedVisits(request) >= MISSED_VISIT_LIMIT;

/** Визит согласован и ещё не наступил. */
export const visitAhead = (request: ServiceRequest, now: Date): Date | undefined => {
  const at = request.appointment?.at;

  return at && at.getTime() + (request.appointment?.minutes ?? VISIT_WINDOW_MINUTES) * 60_000 > now.getTime()
    ? at
    : undefined;
};
