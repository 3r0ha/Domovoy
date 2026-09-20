import { DomainError, isApartmentCode, isCompanyStaff, normalizeApartmentCode, type Apartment } from '@domovoy/domain';

import { apartmentsOf, useApartment, withApartment, withoutApartment } from './apartments.js';
import { recordAction } from './audit.js';
import { atBuilding, homeOf, servesBuilding } from './buildings.js';
import { speak } from './language.js';
import { noopNotifier, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

export interface BindResult {
  resident: Resident;
  apartment: Apartment;
  /** Жилец уже был привязан к этой квартире: ничего не изменилось. */
  alreadyBound: boolean;
}

/** Сколько раз подряд можно промахнуться кодом квартиры. */
export const BIND_ATTEMPTS = 5;

const BIND_WINDOW_MS = 60 * 60 * 1000;

/** Привязка жильца к квартире по коду. @throws {DomainError} */
export const bindApartment = async (deps: AppDeps, resident: Resident, code: string): Promise<BindResult> => {
  const now = deps.now();
  const failed = await deps.repository.countBindAttempts(resident.id, new Date(now.getTime() - BIND_WINDOW_MS));

  if (failed >= BIND_ATTEMPTS) {
    throw new DomainError('too_many_requests', 'Слишком много попыток. Попробуйте через час или позвоните в компанию');
  }

  const wanted = normalizeApartmentCode(code);

  // Чужой код разбирать нечего: попытка засчитывается только за код квартиры,
  // иначе наклейки объектов израсходовали бы лимит.
  if (!isApartmentCode(wanted)) {
    throw new DomainError('code_not_apartment', 'Этот код не от квартиры');
  }

  const apartment = await deps.repository.findApartmentByCode(wanted);

  if (!apartment) {
    await deps.repository.saveBindAttempt({ residentId: resident.id, at: now, ok: false });

    throw new DomainError('apartment_unknown', 'Код не подошёл. Проверьте его в квитанции.');
  }

  await deps.repository.saveBindAttempt({ residentId: resident.id, at: now, ok: true });

  if (apartmentsOf(resident).includes(apartment.id)) {
    const current = resident.apartmentId === apartment.id ? resident : await useApartment(deps, resident, apartment.id);

    return { resident: current, apartment, alreadyBound: true };
  }

  const neighbours = await deps.repository.listResidentsByApartments([apartment.id]);
  const others = neighbours.filter((person) => person.id !== resident.id);

  const saved = await deps.repository.saveResident(withApartment(resident, apartment));

  const notifier = deps.notifier ?? noopNotifier;

  for (const person of others) {
    await notifyResident(
      notifier,
      person,
      speak(person)('app.binding.neighbour', { квартира: apartment.number, кто: saved.displayName }),
    );
  }

  return { resident: saved, apartment, alreadyBound: false };
};

/**
 * Привязка сотрудником. Себя сотрудник не привязывает: иначе он получал бы
 * показания, квитанцию, долг и голос собственника чужой квартиры. @throws {DomainError}
 */
export const bindApartmentByStaff = async (
  deps: AppDeps,
  staff: Resident,
  input: { residentId: string; apartmentId: string },
): Promise<BindResult> => {
  if (!isCompanyStaff(staff.role)) {
    throw new DomainError('forbidden', 'Привязывать жильцов может управляющая компания');
  }

  if (input.residentId === staff.id) {
    throw new DomainError('forbidden', 'Свою квартиру привязывают по коду из квитанции, как жилец');
  }

  const resident = await deps.repository.findResident(input.residentId);

  if (!resident) throw new DomainError('resident_unknown', 'Житель не найден');

  const apartment = await deps.repository.findApartment(input.apartmentId);

  if (!apartment) throw new DomainError('apartment_unknown', 'Квартира не найдена');

  await atBuilding(deps, staff, apartment.buildingId);

  // Человека из чужой организации привязать нельзя: он её житель, а не этого дома.
  const home = await homeOf(deps, resident);

  if (home !== undefined && !(await servesBuilding(deps, staff, home))) {
    throw new DomainError('forbidden', 'Этот человек относится к другой управляющей организации');
  }

  const alreadyBound = apartmentsOf(resident).includes(apartment.id);
  const saved = await deps.repository.saveResident(withApartment(resident, apartment));

  await recordAction(deps, {
    actor: staff,
    action: 'apartment_bound',
    subject: saved.displayName,
    details: `квартира ${apartment.number}`,
    buildingId: apartment.buildingId,
  });

  await notifyResident(
    deps.notifier ?? noopNotifier,
    saved,
    speak(saved)('app.binding.bound', { квартира: apartment.number }),
  );

  return { resident: saved, apartment, alreadyBound };
};

/** Жилец съехал: квартира отвязывается, а заявки и показания остаются у дома. @throws {DomainError} */
export const unbindApartment = async (
  deps: AppDeps,
  actor: Resident,
  residentId: string,
  apartmentId?: string,
): Promise<Resident> => {
  const own = actor.id === residentId;

  if (!own && !isCompanyStaff(actor.role)) {
    throw new DomainError('forbidden', 'Отвязать жильца может он сам или управляющая компания');
  }

  const resident = own ? actor : await deps.repository.findResident(residentId);

  if (!resident) throw new DomainError('resident_unknown', 'Житель не найден');

  const target = apartmentId ?? resident.apartmentId;

  if (!target || !apartmentsOf(resident).includes(target)) return resident;

  const apartment = await deps.repository.findApartment(target);

  if (!own && apartment) await atBuilding(deps, actor, apartment.buildingId);

  const saved = await deps.repository.saveResident(withoutApartment(resident, target));

  await recordAction(deps, {
    actor,
    action: 'apartment_unbound',
    subject: saved.displayName,
    ...(apartment ? { details: `квартира ${apartment.number}` } : {}),
    ...(apartment ? { buildingId: apartment.buildingId } : {}),
  });

  if (!own) {
    const t = speak(saved);

    await notifyResident(
      deps.notifier ?? noopNotifier,
      saved,
      apartment ? t('app.binding.unbound', { квартира: apartment.number }) : t('app.binding.unboundPlain'),
    );
  }

  return saved;
};

export interface UnboundResident {
  id: string;
  displayName: string;
}

/** Кого управляющая компания ещё не связала с квартирой. */
export const listUnbound = async (deps: AppDeps, staff: Resident): Promise<UnboundResident[]> => {
  if (!isCompanyStaff(staff.role)) {
    throw new DomainError('forbidden', 'Список жильцов доступен управляющей компании');
  }

  const found = await deps.repository.listUnboundResidents();
  const mine: UnboundResident[] = [];

  // Человек без дома не относится ни к одной организации: показывать его всем
  // значит отдавать каждому управляющему список всех, кто вообще зашёл в продукт.
  for (const resident of found) {
    const home = resident.buildingId;

    if (!home || !(await servesBuilding(deps, staff, home))) continue;

    mine.push({ id: resident.id, displayName: resident.displayName });
  }

  return mine;
};

export interface ApartmentOption {
  id: string;
  number: number;
  entrance: number;
  riser: number;
  /** Код из квитанции: его компания называет жильцу, если квитанции под рукой нет. */
  code?: string;
}

/** Квартиры дома для выбора при привязке: номер и адрес. */
export const listApartmentsFor = async (deps: AppDeps, staff: Resident): Promise<ApartmentOption[]> => {
  if (!isCompanyStaff(staff.role)) {
    throw new DomainError('forbidden', 'Список квартир доступен управляющей компании');
  }

  const apartments = await deps.repository.listApartments(staff.buildingId ?? deps.defaultBuildingId);

  return apartments
    .map((apartment) => ({
      id: apartment.id,
      number: apartment.number,
      entrance: apartment.entrance,
      riser: apartment.riser,
      ...(apartment.code ? { code: apartment.code } : {}),
    }))
    .sort((left, right) => left.number - right.number);
};
