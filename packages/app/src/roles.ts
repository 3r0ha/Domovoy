import { DomainError, isCompanyStaff, type Apartment, type Role } from '@domovoy/domain';

import { apartmentsOf } from './apartments.js';
import { recordAction } from './audit.js';
import { assertServes, homeOf, listServedBuildings, servedBy } from './buildings.js';
import { noopNotifier, notifyAbout, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

export interface Person {
  id: string;
  displayName: string;
  role: Role;
  /** Квартира человека в этом доме, если она у него есть. */
  apartmentId?: string;
  apartmentNumber?: number;
  /** Сотрудник на дежурстве: ночные заявки уходят ему. */
  onDuty?: boolean;
  /** Дома, которые обслуживает сотрудник: свой плюс дополнительные. */
  buildingIds?: string[];
}

/** Роли раздаёт только управляющий. */
const CAN_ASSIGN: readonly Role[] = ['manager'];

/**
 * Дежурство ставит тот, кто ведёт смену. Мастеру это не поручено: дежурный
 * забирает ночной поток заявок дома, а его телефон уходит жильцам в контакты.
 */
const CAN_SET_DUTY: readonly Role[] = ['dispatcher', 'manager'];

const ROLE_TITLES: Record<Role, string> = {
  resident: 'жилец',
  dispatcher: 'диспетчер',
  technician: 'мастер',
  manager: 'управляющий',
  contractor: 'подрядчик',
};

export const roleTitle = (role: Role): string => ROLE_TITLES[role];

/** Квартира человека среди квартир дома. */
const flatOf = (person: Resident, flats: ReadonlyMap<string, Apartment>): Apartment | undefined => {
  for (const apartmentId of apartmentsOf(person)) {
    const flat = flats.get(apartmentId);

    if (flat) return flat;
  }

  return undefined;
};

/** Люди дома: жильцы и сотрудники. */
export const listPeople = async (deps: AppDeps, staff: Resident): Promise<Person[]> => {
  if (!isCompanyStaff(staff.role)) {
    throw new DomainError('forbidden', 'Список людей дома доступен управляющей компании');
  }

  const buildingId = staff.buildingId ?? deps.defaultBuildingId;

  await assertServes(deps, staff, buildingId);

  const people = await deps.repository.listResidents(buildingId);
  const flats = new Map((await deps.repository.listApartments(buildingId)).map((flat) => [flat.id, flat]));
  const listed: Person[] = [];

  for (const person of people) {
    const apartment = flatOf(person, flats);

    listed.push({
      id: person.id,
      displayName: person.displayName,
      role: person.role,
      ...(apartment ? { apartmentId: apartment.id, apartmentNumber: apartment.number } : {}),
      ...(person.onDuty === true ? { onDuty: true } : {}),
      ...(person.role === 'resident' ? {} : { buildingIds: servedBy(person, deps) }),
    });
  }

  return listed.sort(
    (left, right) => left.role.localeCompare(right.role) || left.displayName.localeCompare(right.displayName),
  );
};

/** Какие дома обслуживает сотрудник. Свой дом остаётся всегда. @throws {DomainError} */
export const setServedBuildings = async (
  deps: AppDeps,
  manager: Resident,
  input: { residentId: string; buildingIds: readonly string[] },
): Promise<Person> => {
  if (manager.role !== 'manager') {
    throw new DomainError('forbidden', 'Дома сотрудникам раздаёт управляющий');
  }

  const person = await deps.repository.findResident(input.residentId);

  if (!person) throw new DomainError('resident_unknown', 'Сотрудник не найден');

  if (person.role === 'resident') {
    throw new DomainError('buildings_for_staff_only', 'Дома обслуживают сотрудники, а не жильцы');
  }

  const own = person.buildingId ?? deps.defaultBuildingId;
  const mine = new Set((await listServedBuildings(deps, manager)).map((building) => building.id));
  const extra: string[] = [];

  for (const buildingId of new Set(input.buildingIds)) {
    if (buildingId === own) continue;
    if (!(await deps.repository.findBuilding(buildingId))) {
      throw new DomainError('building_not_found', 'Дом не найден');
    }
    if (!mine.has(buildingId)) {
      throw new DomainError('forbidden', 'Дом обслуживает другая управляющая организация');
    }

    extra.push(buildingId);
  }

  const saved = await deps.repository.saveResident({ ...person, servesBuildingIds: extra });
  const buildings = await deps.repository.listBuildings();
  const names = servedBy(saved, deps)
    .map((id) => buildings.find((building) => building.id === id)?.code ?? id)
    .join(', ');

  await recordAction(deps, {
    actor: manager,
    action: 'buildings_changed',
    subject: saved.displayName,
    details: names,
  });

  if (saved.id !== manager.id) {
    await notifyResident(
      deps.notifier ?? noopNotifier,
      saved,
      `Ваши дома: ${names}.\nЗаявки по ним будут приходить вам.`,
    );
  }

  return {
    id: saved.id,
    displayName: saved.displayName,
    role: saved.role,
    ...(saved.onDuty === true ? { onDuty: true } : {}),
    buildingIds: servedBy(saved, deps),
  };
};

/** Назначение роли. @throws {DomainError} */
export const assignRole = async (
  deps: AppDeps,
  manager: Resident,
  input: { residentId: string; role: Role },
): Promise<Person> => {
  if (!CAN_ASSIGN.includes(manager.role)) {
    throw new DomainError('forbidden', 'Роли раздаёт управляющий');
  }

  if (input.residentId === manager.id) {
    throw new DomainError('role_self_change', 'Свою роль изменить нельзя, попросите другого управляющего');
  }

  const person = await deps.repository.findResident(input.residentId);

  if (!person) throw new DomainError('resident_unknown', 'Житель не найден');

  const buildingId = manager.buildingId ?? deps.defaultBuildingId;
  const reachable = new Set((await listServedBuildings(deps, manager)).map((building) => building.id));
  const home = await homeOf(deps, person);

  // Человек без дома прежде проходил эту проверку, и его делал своим сотрудником
  // любой управляющий установки.
  if (home === undefined || !reachable.has(home)) {
    throw new DomainError('forbidden', 'Этот человек относится к другой управляющей организации');
  }

  if (person.role === input.role) {
    return { id: person.id, displayName: person.displayName, role: person.role };
  }

  const saved = await deps.repository.saveResident({
    ...person,
    role: input.role,
    buildingId: input.role === 'resident' ? home : buildingId,
  });

  await recordAction(deps, {
    actor: manager,
    action: 'role_assigned',
    subject: saved.displayName,
    details: roleTitle(input.role),
    buildingId,
  });

  await notifyResident(
    deps.notifier ?? noopNotifier,
    saved,
    input.role === 'resident'
      ? 'Управляющая компания сняла с вас служебную роль. Заявки и показания остаются доступны.'
      : `Управляющая компания назначила вам роль: ${roleTitle(input.role)}.\n` +
          'Наберите /start, чтобы увидеть новые команды.',
  );

  return { id: saved.id, displayName: saved.displayName, role: saved.role };
};

/** Постановка сотрудника на дежурство. @throws {DomainError} */
export const setDuty = async (
  deps: AppDeps,
  staff: Resident,
  input: { residentId: string; onDuty: boolean },
): Promise<Person> => {
  if (!CAN_SET_DUTY.includes(staff.role)) {
    throw new DomainError('forbidden', 'Дежурство назначает диспетчер или управляющий');
  }

  const person = await deps.repository.findResident(input.residentId);

  if (!person) throw new DomainError('resident_unknown', 'Сотрудник не найден');

  if (person.role === 'resident') {
    throw new DomainError('duty_for_staff_only', 'Дежурят сотрудники, а не жильцы');
  }

  if (person.buildingId === undefined) {
    throw new DomainError('forbidden', 'У этого сотрудника нет дома, в котором он ведёт смену');
  }

  await assertServes(deps, staff, person.buildingId);

  const saved = await deps.repository.saveResident({ ...person, onDuty: input.onDuty });

  await recordAction(deps, {
    actor: staff,
    action: 'duty_changed',
    subject: saved.displayName,
    details: input.onDuty ? 'на дежурстве' : 'снято',
  });

  if (saved.id !== staff.id) {
    await notifyAbout(
      deps.notifier ?? noopNotifier,
      saved,
      input.onDuty ? 'Вы на дежурстве: ночные заявки по дому будут приходить вам.' : 'Дежурство с вас снято.',
      { section: 'queue' },
    );
  }

  return {
    id: saved.id,
    displayName: saved.displayName,
    role: saved.role,
    ...(saved.onDuty === true ? { onDuty: true } : {}),
  };
};
