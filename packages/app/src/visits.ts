import {
  DomainError,
  bookVisit,
  cancelVisit,
  checkReception,
  checkVisitMinutes,
  completeVisit,
  formatClock,
  formatDay,
  formatReception,
  isActiveVisit,
  isCompanyStaff,
  receptionSlots,
  writeVisit,
  VISIT_MINUTES,
  type ReceptionWindow,
  type Visit,
} from '@domovoy/domain';

import { assertServes, homeBuildingOf } from './buildings.js';
import { recordAction } from './audit.js';
import { noopNotifier, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { zoneOf } from './zone.js';

/** Приём в управляющей организации: окна, свободные часы и своя запись. */
export interface Reception {
  buildingId: string;
  /** Приёмные окна дома. Пустой список означает, что приём не ведётся. */
  windows: ReceptionWindow[];
  minutes: number;
  /** Свободные часы по порядку. */
  slots: Date[];
  /** Действующая запись спрашивающего. */
  mine?: Visit;
  /** Адрес приёма из карточки дома. */
  office?: string;
}

/** На сколько дней вперёд показывать свободные часы. */
const HORIZON_DAYS = 14;

const houseOf = async (deps: AppDeps, resident: Resident, buildingId?: string): Promise<string> => {
  const house = buildingId ?? (await homeBuildingOf(deps, resident));

  await assertServes(deps, resident, house);

  return house;
};

/** Занятое время дома: отменённые записи время не держат. */
const takenAt = async (deps: AppDeps, buildingId: string): Promise<Date[]> => {
  const booked = await deps.repository.listVisits({
    buildingId,
    statuses: ['booked'],
    from: deps.now(),
  });

  return booked.map((visit) => visit.at);
};

/** Что человек видит в разделе приёма. @throws {DomainError} если дом чужой. */
export const receptionFor = async (deps: AppDeps, resident: Resident, buildingId?: string): Promise<Reception> => {
  const house = await houseOf(deps, resident, buildingId);
  const building = await deps.repository.findBuilding(house);
  const windows = building?.reception ?? [];
  const minutes = building?.visitMinutes ?? VISIT_MINUTES;
  const now = deps.now();

  const mine = (await deps.repository.listVisits({ buildingId: house, residentId: resident.id })).find((visit) =>
    isActiveVisit(visit, now),
  );

  const slots =
    windows.length === 0
      ? []
      : receptionSlots({
          windows,
          minutes,
          from: now,
          days: HORIZON_DAYS,
          taken: await takenAt(deps, house),
          timeZone: await zoneOf(deps, house),
        });

  return {
    buildingId: house,
    windows,
    minutes,
    slots,
    ...(mine ? { mine } : {}),
    ...(building?.service?.office ? { office: building.service.office } : {}),
  };
};

export interface BookVisitCommand {
  resident: Resident;
  /** Выбранное время приёма. */
  at: Date;
  topic: string;
  buildingId?: string;
}

/** Нарушение уникального индекса занятого времени (миграция 047). */
const isSlotClash = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

/** Запись на приём. Смена узнаёт о ней уведомлением. @throws {DomainError} */
export const takeVisit = async (deps: AppDeps, command: BookVisitCommand): Promise<Visit> => {
  const reception = await receptionFor(deps, command.resident, command.buildingId);

  if (reception.windows.length === 0) {
    throw new DomainError('reception_empty', 'Управляющая организация не ведёт приём по записи');
  }

  if (reception.mine) throw new DomainError('visit_exists', 'У вас уже есть запись на приём');

  const visit = bookVisit({
    id: deps.createId(),
    buildingId: reception.buildingId,
    residentId: command.resident.id,
    at: command.at,
    minutes: reception.minutes,
    topic: command.topic,
    now: deps.now(),
    slots: reception.slots,
  });

  // Свободные часы считаны до записи, поэтому за это время слот мог занять
  // другой жилец: последнее слово за хранилищем, а не за подсчётом.
  const saved = await deps.repository.saveVisit(visit).catch((error: unknown) => {
    if (isSlotClash(error)) throw new DomainError('slot_taken', 'Это время только что заняли, выберите другое');

    throw error;
  });

  const zone = await zoneOf(deps, saved.buildingId);
  const notifier = deps.notifier ?? noopNotifier;

  const when = `${formatDay(saved.at, zone)}, ${formatClock(saved.at, zone)}`;

  for (const person of await deps.repository.listStaff(saved.buildingId)) {
    await notifyResident(
      notifier,
      person,
      `Запись на приём: ${when}\n${command.resident.displayName}: ${saved.topic}`,
    );
  }

  await recordAction(deps, {
    actor: command.resident,
    action: 'visit_booked',
    subject: when,
    buildingId: saved.buildingId,
  });

  return saved;
};

/** Дом смены и право на него. @throws {DomainError} */
const shiftHouse = async (deps: AppDeps, staff: Resident, buildingId?: string): Promise<string> => {
  if (!isCompanyStaff(staff.role)) throw new DomainError('forbidden', 'Приём ведёт управляющая организация');

  const house = buildingId ?? staff.buildingId ?? deps.defaultBuildingId;

  await assertServes(deps, staff, house);

  return house;
};

export interface ReceptionHoursCommand {
  staff: Resident;
  /** Приёмные окна дома. Пустой список означает, что приём по записи не ведётся. */
  windows: ReceptionWindow[];
  /** Сколько минут занимает один приём. */
  minutes?: number;
  buildingId?: string;
}

/** Приёмные часы дома задаёт смена этого дома. @throws {DomainError} */
export const setReception = async (deps: AppDeps, command: ReceptionHoursCommand): Promise<Reception> => {
  const house = await shiftHouse(deps, command.staff, command.buildingId);
  const known = await deps.repository.findBuilding(house);

  if (!known) throw new DomainError('building_not_found', 'Дом не найден');

  const windows = checkReception(command.windows);
  const minutes = checkVisitMinutes(command.minutes ?? known.visitMinutes ?? VISIT_MINUTES);

  // Пустые часы убирают приём по записи целиком, поэтому поля снимаются, а не
  // остаются пустым списком.
  const { reception, visitMinutes, ...rest } = known;
  void reception;
  void visitMinutes;

  await deps.repository.saveBuilding({
    ...rest,
    ...(windows.length > 0 ? { reception: windows, visitMinutes: minutes } : {}),
  });

  await recordAction(deps, {
    actor: command.staff,
    action: 'reception_changed',
    subject: windows.length > 0 ? formatReception(windows) : 'приём по записи не ведётся',
    buildingId: house,
  });

  return receptionFor(deps, command.staff, house);
};

export interface RecordVisitCommand {
  staff: Resident;
  /** Кого записали. */
  residentId: string;
  topic: string;
  /** Когда пришли или придут. По умолчанию сейчас. */
  at?: Date;
  buildingId?: string;
}

/**
 * Сотрудник записывает пришедшего. Человек у стойки не заполняет форму сам,
 * поэтому часы приёма здесь не проверяются: запись прошедшим временем означает
 * состоявшийся приём, будущим, что человека записали. @throws {DomainError}
 */
export const recordVisit = async (deps: AppDeps, command: RecordVisitCommand): Promise<Visit> => {
  const house = await shiftHouse(deps, command.staff, command.buildingId);
  const visitor = await deps.repository.findResident(command.residentId);

  if (!visitor) throw new DomainError('resident_unknown', 'Человек не найден');

  const now = deps.now();
  const building = await deps.repository.findBuilding(house);

  const visit = writeVisit({
    id: deps.createId(),
    buildingId: house,
    residentId: visitor.id,
    at: command.at ?? now,
    minutes: building?.visitMinutes ?? VISIT_MINUTES,
    topic: command.topic,
    now,
  });

  const saved = await deps.repository.saveVisit(visit).catch((error: unknown) => {
    if (isSlotClash(error)) throw new DomainError('slot_taken', 'Это время уже занято, выберите другое');

    throw error;
  });

  const zone = await zoneOf(deps, house);
  const when = `${formatDay(saved.at, zone)}, ${formatClock(saved.at, zone)}`;

  // О записи на будущее человека предупреждают: о состоявшемся приёме он знает и так.
  if (saved.status === 'booked') {
    await notifyResident(
      deps.notifier ?? noopNotifier,
      visitor,
      `Управляющая организация записала вас на приём: ${when}.\n${saved.topic}`,
    );
  }

  await recordAction(deps, {
    actor: command.staff,
    action: 'visit_recorded',
    subject: when,
    details: `${visitor.displayName}: ${saved.topic}`,
    buildingId: house,
  });

  return saved;
};

/** Запись отменена: жильцом своя, сотрудником любая в его доме. @throws {DomainError} */
export const dropVisit = async (deps: AppDeps, resident: Resident, visitId: string): Promise<Visit> => {
  const visit = await deps.repository.findVisit(visitId);

  if (!visit) throw new DomainError('visit_not_found', 'Запись не найдена');

  const staff = isCompanyStaff(resident.role);

  if (!staff && visit.residentId !== resident.id) throw new DomainError('visit_not_found', 'Запись не найдена');

  await assertServes(deps, resident, visit.buildingId);

  const cancelled = await deps.repository.saveVisit(cancelVisit(visit, deps.now()));
  const zone = await zoneOf(deps, visit.buildingId);
  const notifier = deps.notifier ?? noopNotifier;

  // Отменившего уведомлять незачем: он только что нажал кнопку.
  const author = staff ? await deps.repository.findResident(visit.residentId) : undefined;

  if (author) {
    await notifyResident(
      notifier,
      author,
      `Приём ${formatDay(visit.at, zone)} в ${formatClock(visit.at, zone)} отменён управляющей организацией.`,
    );
  }

  await recordAction(deps, {
    actor: resident,
    action: 'visit_cancelled',
    subject: `${formatDay(visit.at, zone)}, ${formatClock(visit.at, zone)}`,
    buildingId: visit.buildingId,
  });

  return cancelled;
};

/** Приём состоялся: отмечает смена. @throws {DomainError} */
export const markVisitDone = async (deps: AppDeps, staff: Resident, visitId: string): Promise<Visit> => {
  if (!isCompanyStaff(staff.role)) throw new DomainError('forbidden', 'Приём отмечает управляющая организация');

  const visit = await deps.repository.findVisit(visitId);

  if (!visit) throw new DomainError('visit_not_found', 'Запись не найдена');

  await assertServes(deps, staff, visit.buildingId);

  return deps.repository.saveVisit(completeVisit(visit));
};

export interface VisitCard {
  visit: Visit;
  /** Кто записался. */
  residentName?: string;
  apartment?: number;
}

/** Записи на приём: смене по дому смены, жильцу свои. */
export const listVisitsFor = async (deps: AppDeps, resident: Resident, buildingId?: string): Promise<VisitCard[]> => {
  const staff = isCompanyStaff(resident.role);
  // Сотрудник ведёт приём там, где работает, а живёт он не обязательно там же.
  const house = staff
    ? (buildingId ?? resident.buildingId ?? deps.defaultBuildingId)
    : await houseOf(deps, resident, buildingId);

  if (staff) await assertServes(deps, resident, house);

  const visits = await deps.repository.listVisits({
    buildingId: house,
    ...(staff ? {} : { residentId: resident.id }),
    statuses: ['booked'],
    from: deps.now(),
  });

  const cards: VisitCard[] = [];

  for (const visit of visits) {
    const author = staff ? await deps.repository.findResident(visit.residentId) : resident;
    const apartment = author?.apartmentId ? await deps.repository.findApartment(author.apartmentId) : undefined;

    cards.push({
      visit,
      ...(author?.displayName ? { residentName: author.displayName } : {}),
      ...(apartment ? { apartment: apartment.number } : {}),
    });
  }

  return cards;
};

/** Запись словами: тем же текстом отвечает бот. */
export const formatVisit = (visit: Visit, timeZone?: string): string =>
  `${formatDay(visit.at, timeZone)}, ${formatClock(visit.at, timeZone)}: ${visit.topic}`;
