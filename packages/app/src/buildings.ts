import { DomainError, isCompanyStaff, type Apartment } from '@domovoy/domain';

import { apartmentIn, apartmentsOf } from './apartments.js';
import type { Building, HouseContact, HouseService, Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/**
 * Дома сотрудника: свой и те, что ему добавили. Дом установки не подставляется:
 * иначе сотрудник без дома получал бы права на дом по умолчанию.
 */
export const servedBy = (resident: Resident, _deps: AppDeps): string[] => [
  ...new Set([...(resident.buildingId ? [resident.buildingId] : []), ...(resident.servesBuildingIds ?? [])]),
];

/**
 * Дом, в котором человек сейчас действует: выбранный, рабочий или дом установки.
 * Умолчание здесь для сценариев создания: права проверяет `assertServes`.
 */
export const actingHouse = (deps: AppDeps, actor: Resident, buildingId?: string): string =>
  buildingId ?? actor.buildingId ?? deps.defaultBuildingId;

/**
 * Дом, в котором человек живёт. У сотрудника он может не совпадать с рабочим:
 * смену он ведёт в одном доме, а квартира у него в другом. Для проверок права
 * берётся `homeOf`: он не подставляет дом установки.
 */
/**
 * Есть ли у человека свой дом: квартира, обслуживание или, у сотрудника,
 * рабочий дом. Жильцу дом без квартиры своим не считается: после отвязки или
 * удаления профиля привязка остаётся, а прав на дом за ней уже нет.
 */
export const housed = (resident: Resident): boolean =>
  (isCompanyStaff(resident.role) && Boolean(resident.buildingId)) ||
  apartmentsOf(resident).length > 0 ||
  (resident.servesBuildingIds?.length ?? 0) > 0;

export const homeBuildingOf = async (deps: AppDeps, resident: Resident): Promise<string> => {
  const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;

  return apartment?.buildingId ?? resident.buildingId ?? deps.defaultBuildingId;
};

/**
 * Адрес дома для уведомления. Он есть только у тех, у кого домов больше одного.
 */
export const houseHint = async (
  deps: AppDeps,
  resident: Resident,
  buildingId: string,
): Promise<string | undefined> => {
  const houses = new Set<string>(
    isCompanyStaff(resident.role) && resident.buildingId ? [resident.buildingId] : [],
  );

  for (const apartmentId of apartmentsOf(resident)) {
    const apartment = await deps.repository.findApartment(apartmentId);

    if (apartment) houses.add(apartment.buildingId);
  }

  if (houses.size < 2) return undefined;

  const building = await deps.repository.findBuilding(buildingId);

  return building?.address || building?.code;
};

/** Подсказка с адресом для одного получателя рассылки. */
export type HouseHint = (resident: Resident) => Promise<string | undefined>;

/**
 * Подсказка с адресом дома для рассылки по нему: дом и его квартиры читаются
 * один раз на всю рассылку, а не на каждого получателя. Квартиры, уже прочитанные
 * вызывающим, передаются готовыми.
 */
export const houseHintFor = (deps: AppDeps, buildingId: string, known?: readonly Apartment[]): HouseHint => {
  const houses = new Map<string, string | undefined>(
    (known ?? []).map((apartment) => [apartment.id, apartment.buildingId]),
  );

  let address: Promise<string | undefined> | undefined;
  let all: Promise<void> | undefined;

  const addressOf = (): Promise<string | undefined> =>
    (address ??= deps.repository
      .findBuilding(buildingId)
      .then((building) => building?.address || building?.code));

  const houseOf = async (apartmentId: string): Promise<string | undefined> => {
    if (!known) {
      all ??= deps.repository.listApartments(buildingId).then((apartments) => {
        for (const apartment of apartments) houses.set(apartment.id, apartment.buildingId);
      });

      await all;
    }

    if (!houses.has(apartmentId)) {
      houses.set(apartmentId, (await deps.repository.findApartment(apartmentId))?.buildingId);
    }

    return houses.get(apartmentId);
  };

  return async (resident) => {
    const own = new Set<string>(
      isCompanyStaff(resident.role) && resident.buildingId ? [resident.buildingId] : [],
    );

    for (const apartmentId of apartmentsOf(resident)) {
      const house = await houseOf(apartmentId);

      if (house) own.add(house);
    }

    return own.size < 2 ? undefined : addressOf();
  };
};

/**
 * Дома, о которых человеку положено знать: свой и, у смены, рабочий.
 * Сотрудник, который живёт в другом доме, видит и собрания своего дома,
 * и собрания дома, где ведёт смену.
 */
export const housesOf = async (deps: AppDeps, resident: Resident): Promise<string[]> => {
  const home = await homeOf(deps, resident);
  const houses = new Set<string>(home ? [home] : []);

  if (isCompanyStaff(resident.role) && resident.buildingId) houses.add(resident.buildingId);

  return [...houses];
};

/** Дом жильца без подстановки дома по умолчанию. */
export const homeOf = async (deps: AppDeps, resident: Resident): Promise<string | undefined> => {
  const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;

  return apartment?.buildingId ?? resident.buildingId;
};

export interface ServedBuilding {
  id: string;
  code: string;
  address: string;
  /** Дом, с которым человек работает по умолчанию: его показывают при входе. */
  current: boolean;
  timeZone?: string;
  managementCompany?: string;
  /** К дому привязан общий чат: объявления и аварии уходят и туда. */
  chatBound: boolean;
  /** Ответственный по дому от управляющей компании. */
  contact?: HouseContact;
  /** Телефоны, режим работы и адрес приёма. */
  service?: HouseService;
}

/**
 * Дома одной организации. Дом без владельца не принадлежит никому: он свой
 * только сам себе, иначе дома разных компаний сошлись бы в один общий парк.
 */
const sameCompany = (left?: Building, right?: Building): boolean => {
  if (!left || !right) return false;

  if (left.companyId !== undefined || right.companyId !== undefined) return left.companyId === right.companyId;

  return left.id === right.id;
};

/** Дома, доступные человеку. */
export const listServedBuildings = async (deps: AppDeps, resident: Resident): Promise<ServedBuilding[]> => {
  const currentId = resident.buildingId;
  const own = currentId ? await deps.repository.findBuilding(currentId) : undefined;

  if (!isCompanyStaff(resident.role)) return own ? [describe(own, own.id)] : [];

  const granted = new Set(servedBy(resident, deps));

  return (await deps.repository.listBuildings())
    .filter((building) => sameCompany(building, own) || granted.has(building.id))
    .sort((left, right) => left.code.localeCompare(right.code, 'ru'))
    .map((building) => describe(building, currentId ?? ''));
};

/**
 * Дом в границах человека: свой, отданный вручную или дом той же организации.
 * Жильцу доступен только его собственный. Дом установки не подставляется:
 * иначе дом по умолчанию доставался бы каждому, кто ещё нигде не живёт.
 */
export const servesBuilding = async (deps: AppDeps, resident: Resident, buildingId: string): Promise<boolean> => {
  const currentId = resident.buildingId;

  if (currentId !== undefined && buildingId === currentId) return true;

  if (!isCompanyStaff(resident.role)) {
    const apartment = await apartmentIn(deps, resident, buildingId);

    return apartment !== undefined;
  }

  if (servedBy(resident, deps).includes(buildingId)) return true;

  if (currentId === undefined) return false;

  const building = await deps.repository.findBuilding(buildingId);

  if (!building) return false;

  return sameCompany(building, await deps.repository.findBuilding(currentId));
};

/**
 * Дом для человека без своего дома: тот, что остался в привязке, если он ещё
 * есть, иначе дом установки. Открытые сведения дома он читает без проверки прав.
 */
export const publicHouseOf = async (deps: AppDeps, resident: Resident): Promise<string> => {
  const known = resident.buildingId ? await deps.repository.findBuilding(resident.buildingId) : undefined;

  return known?.id ?? deps.defaultBuildingId;
};

/** Дом чужой организации закрыт и по прямой ссылке на объект. @throws {DomainError} */
export const assertServes = async (deps: AppDeps, resident: Resident, buildingId: string): Promise<void> => {
  if (await servesBuilding(deps, resident, buildingId)) return;

  throw new DomainError('forbidden', 'Этот дом обслуживает другая управляющая организация');
};

/** Человек в выбранном доме. @throws {DomainError} */
export const atBuilding = async (
  deps: AppDeps,
  resident: Resident,
  buildingId?: string,
): Promise<Resident> => {
  if (!buildingId || buildingId === resident.buildingId) return resident;

  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'Чужой дом видят только сотрудники управляющей компании');
  }

  // Несуществующий дом и дом чужой организации отвечают одинаково: иначе
  // перебором идентификаторов читается состав установки.
  if (!(await deps.repository.findBuilding(buildingId)) || !(await servesBuilding(deps, resident, buildingId))) {
    throw new DomainError('building_not_found', 'Дом не найден');
  }

  return { ...resident, buildingId };
};

const describe = (building: Building, currentId: string): ServedBuilding => ({
  id: building.id,
  code: building.code,
  address: building.address,
  current: building.id === currentId,
  chatBound: building.chatId !== undefined,
  ...(building.timeZone ? { timeZone: building.timeZone } : {}),
  ...(building.managementCompany ? { managementCompany: building.managementCompany } : {}),
  ...(building.contact ? { contact: building.contact } : {}),
  ...(building.service ? { service: building.service } : {}),
});

export interface HouseContacts {
  buildingId: string;
  address: string;
  /** Название управляющей организации. */
  managementCompany?: string;
  /** Ответственный по дому, если управляющий его указал. */
  contact?: HouseContact;
  /** Телефоны, режим работы и адрес приёма. */
  service?: HouseService;
  /** Телефон дежурного: он есть, пока в смене кто-то стоит. */
  duty?: { displayName: string; phone?: string };
}

/** К кому обращаться по дому. @throws {DomainError} если дом чужой. */
export const contactsFor = async (
  deps: AppDeps,
  resident: Resident,
  buildingId?: string,
): Promise<HouseContacts> => {
  const settled = housed(resident);

  // Новому человеку без дома контакты нужны раньше привязки: телефон аварийной
  // службы стоит на первом экране. Он получает контакты своего дома или дома
  // по умолчанию, а выбранный дом, оставшийся в приложении, не проверяется.
  const house = settled ? (buildingId ?? (await homeBuildingOf(deps, resident))) : await publicHouseOf(deps, resident);

  if (settled) await assertServes(deps, resident, house);

  const building = await deps.repository.findBuilding(house);
  // Имя и телефон дежурного видят только свои: постороннему остаются
  // телефоны организации.
  const duty = settled
    ? (await deps.repository.listStaff(house)).find((person) => person.onDuty === true)
    : undefined;

  return {
    buildingId: house,
    address: building?.address ?? '',
    ...(building?.managementCompany ? { managementCompany: building.managementCompany } : {}),
    ...(building?.contact ? { contact: building.contact } : {}),
    ...(building?.service ? { service: building.service } : {}),
    ...(duty
      ? { duty: { displayName: duty.displayName, ...(duty.phone ? { phone: duty.phone } : {}) } }
      : {}),
  };
};

/** Кто отвечает по дому: имя, должность и телефон одной строкой. */
const contactLine = (contact?: HouseContact): string | undefined => {
  if (!contact) return undefined;

  const title = contact.role ? `${contact.name} (${contact.role})` : contact.name;

  return `Ответственный: ${[title, contact.phone, contact.email].filter(Boolean).join(', ')}`;
};

/**
 * Контакты словами: тем же текстом отвечает бот. Каждая строка это один способ
 * связи, срочное сверху: в переписке читают первые строки, а не весь список.
 */
export const formatContacts = (contacts: HouseContacts): string => {
  const service = contacts.service;
  const duty = contacts.duty;

  const lines = [
    service?.emergencyPhone ? `Авария, круглосуточно: ${service.emergencyPhone}` : undefined,
    duty ? `Дежурит сейчас: ${[duty.displayName, duty.phone].filter(Boolean).join(', ')}` : undefined,
    [contacts.managementCompany, contacts.address].filter(Boolean).join(', ') || undefined,
    [service?.phone && `Телефон: ${service.phone}`, service?.hours].filter(Boolean).join(' · ') || undefined,
    service?.email ? `Почта: ${service.email}` : undefined,
    service?.office ? `Приём: ${[service.office, service.officeHours].filter(Boolean).join(' · ')}` : undefined,
    contactLine(contacts.contact),
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);

  return lines.length > 0 ? lines.join('\n') : 'Контакты не заведены: напишите в поддержку, ответит смена.';
};
