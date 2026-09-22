import {
  DomainError,
  checkShare,
  isApartmentCode,
  isCompanyStaff,
  normalizeApartmentCode,
  type Apartment,
} from '@domovoy/domain';

import {
  apartmentsOf,
  ownsApartment,
  useApartment,
  withApartment,
  withOwnership,
  withoutApartment,
  withoutOwnership,
} from './apartments.js';
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

  // Первый, кто привязал помещение, считается его собственником со своих слов:
  // код лежит в квитанции собственника. Следующий становится проживающим, и
  // право собственности за ним подтверждает управляющая организация: иначе
  // голос на собрании получал бы любой, кто дотянулся до чужой квитанции.
  const claimed = others.some((person) => ownsApartment(person, apartment.id));
  const bound = withApartment(resident, apartment);

  const saved = await deps.repository.saveResident(
    claimed ? bound : withOwnership(bound, apartment.id, 1, 'stated'),
  );

  const notifier = deps.notifier ?? noopNotifier;

  for (const person of others) {
    await notifyResident(
      notifier,
      person,
      speak(person)('app.binding.neighbour', { квартира: apartment.number, кто: saved.displayName }),
      [],
      { dropFlatmate: saved.id },
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
    throw new DomainError('forbidden', 'Привязывать жильцов может управляющая организация');
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

/**
 * Жилец говорит, собственник он или живёт в помещении на других основаниях.
 * От этого зависит голос на собрании: голосуют собственники, ч. 3 ст. 48 ЖК РФ.
 * Слова человека управляющая организация потом подтверждает или исправляет.
 * @throws {DomainError}
 */
export const declareOwnership = async (
  deps: AppDeps,
  resident: Resident,
  owner: boolean,
  apartmentId?: string,
): Promise<Resident> => {
  const target = apartmentId ?? resident.apartmentId;

  if (!target || !apartmentsOf(resident).includes(target)) {
    throw new DomainError('apartment_not_bound', 'Сначала привяжите квартиру по коду из квитанции');
  }

  const saved = await deps.repository.saveResident(
    owner ? withOwnership(resident, target, 1, 'stated') : withoutOwnership(resident, target),
  );

  // Собственников у помещения бывает несколько, и слова одного касаются всех:
  // от них зависит, чьим голосом считается голос квартиры на собрании.
  if (owner) {
    const others = (await deps.repository.listResidentsByApartments([target])).filter(
      (person) => person.id !== resident.id && person.role === 'resident',
    );

    const apartment = await deps.repository.findApartment(target);

    for (const person of others) {
      await notifyResident(
        deps.notifier ?? noopNotifier,
        person,
        speak(person)('app.binding.ownerClaimed', {
          квартира: apartment?.number ?? '',
          кто: saved.displayName,
        }),
      );
    }
  }

  return saved;
};

/**
 * Управляющая организация подтверждает право собственности и долю. Её запись
 * сильнее слов жильца: на ней и держится юридическая сила собрания.
 * @throws {DomainError}
 */
export const setOwnership = async (
  deps: AppDeps,
  staff: Resident,
  input: { residentId: string; apartmentId: string; share: number | null },
): Promise<Resident> => {
  if (!isCompanyStaff(staff.role)) {
    throw new DomainError('forbidden', 'Право собственности отмечает управляющая организация');
  }

  const resident = await deps.repository.findResident(input.residentId);

  if (!resident) throw new DomainError('resident_unknown', 'Житель не найден');

  const apartment = await deps.repository.findApartment(input.apartmentId);

  if (!apartment) throw new DomainError('apartment_unknown', 'Квартира не найдена');

  await atBuilding(deps, staff, apartment.buildingId);

  if (!apartmentsOf(resident).includes(apartment.id)) {
    throw new DomainError('apartment_not_bound', 'Этот человек к квартире не привязан');
  }

  const saved = await deps.repository.saveResident(
    input.share === null
      ? withoutOwnership(resident, apartment.id)
      : withOwnership(resident, apartment.id, checkShare(input.share), 'company'),
  );

  await recordAction(deps, {
    actor: staff,
    action: 'apartment_bound',
    subject: saved.displayName,
    details:
      input.share === null
        ? `квартира ${apartment.number}: не собственник`
        : `квартира ${apartment.number}: собственник, доля ${input.share}`,
    buildingId: apartment.buildingId,
  });

  return saved;
};

/** Кто ещё привязан к этой квартире и на каком основании. */
export interface FlatNeighbour {
  id: string;
  displayName: string;
  /** Собственник помещения, а не просто проживающий. */
  owner: boolean;
  /** Это сам спрашивающий. */
  self: boolean;
}

/**
 * Кто привязан к квартире. Код из квитанции лежит в почтовом ящике, и привязка
 * по нему даёт и квитанцию, и домофон, и голос: жилец должен видеть, кто ещё
 * в его квартире значится, и убирать чужого сам. @throws {DomainError}
 */
export const flatNeighbours = async (
  deps: AppDeps,
  resident: Resident,
  apartmentId?: string,
): Promise<FlatNeighbour[]> => {
  const target = apartmentId ?? resident.apartmentId;

  if (!target || !apartmentsOf(resident).includes(target)) {
    throw new DomainError('apartment_not_bound', 'Сначала привяжите квартиру по коду из квитанции');
  }

  const people = await deps.repository.listResidentsByApartments([target]);

  return people
    .filter((person) => person.role === 'resident')
    .map((person) => ({
      id: person.id,
      displayName: person.displayName,
      owner: ownsApartment(person, target),
      self: person.id === resident.id,
    }));
};

/**
 * Убрать из своей квартиры чужого. Собственника снимает собственник или
 * управляющая организация: иначе привязавшийся по чужой квитанции выгонял бы
 * настоящего владельца. @throws {DomainError}
 */
export const dropNeighbour = async (
  deps: AppDeps,
  resident: Resident,
  residentId: string,
  apartmentId?: string,
): Promise<FlatNeighbour[]> => {
  const target = apartmentId ?? resident.apartmentId;

  if (!target || !apartmentsOf(resident).includes(target)) {
    throw new DomainError('apartment_not_bound', 'Сначала привяжите квартиру по коду из квитанции');
  }

  if (residentId === resident.id) {
    throw new DomainError('forbidden', 'Себя отвязывают в разделе «Моя квартира»');
  }

  const other = await deps.repository.findResident(residentId);

  if (!other || !apartmentsOf(other).includes(target)) {
    throw new DomainError('resident_unknown', 'Этот человек к вашей квартире не привязан');
  }

  if (ownsApartment(other, target) && !ownsApartment(resident, target)) {
    throw new DomainError('forbidden', 'Собственника помещения отвязывает собственник или управляющая организация');
  }

  await unbindApartment(deps, resident, residentId, target, true);

  return flatNeighbours(deps, resident, target);
};

/** Жилец съехал: квартира отвязывается, а заявки и показания остаются у дома. @throws {DomainError} */
export const unbindApartment = async (
  deps: AppDeps,
  actor: Resident,
  residentId: string,
  apartmentId?: string,
  byNeighbour = false,
): Promise<Resident> => {
  const own = actor.id === residentId;

  if (!own && !byNeighbour && !isCompanyStaff(actor.role)) {
    throw new DomainError('forbidden', 'Отвязать жильца может он сам или управляющая организация');
  }

  const resident = own ? actor : await deps.repository.findResident(residentId);

  if (!resident) throw new DomainError('resident_unknown', 'Житель не найден');

  const target = apartmentId ?? resident.apartmentId;

  if (!target || !apartmentsOf(resident).includes(target)) return resident;

  const apartment = await deps.repository.findApartment(target);

  if (!own && !byNeighbour && apartment) await atBuilding(deps, actor, apartment.buildingId);

  const saved = await deps.repository.saveResident(withoutOwnership(withoutApartment(resident, target), target));

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

/** Кого управляющая организация ещё не связала с квартирой. */
export const listUnbound = async (deps: AppDeps, staff: Resident): Promise<UnboundResident[]> => {
  if (!isCompanyStaff(staff.role)) {
    throw new DomainError('forbidden', 'Список жильцов доступен управляющей организации');
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
    throw new DomainError('forbidden', 'Список квартир доступен управляющей организации');
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
