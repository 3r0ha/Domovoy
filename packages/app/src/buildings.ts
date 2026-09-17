import { DomainError, isCompanyStaff } from '@domovoy/domain';

import { apartmentIn, apartmentsOf } from './apartments.js';
import type { Building, HouseContact, HouseService, Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Дома сотрудника: свой и те, что ему добавили. */
export const servedBy = (resident: Resident, deps: AppDeps): string[] => [
  ...new Set([resident.buildingId ?? deps.defaultBuildingId, ...(resident.servesBuildingIds ?? [])]),
];

/**
 * Дом, в котором человек живёт. У сотрудника он может не совпадать с рабочим:
 * смену он ведёт в одном доме, а квартира у него в другом.
 */
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
    isCompanyStaff(resident.role) ? [resident.buildingId ?? deps.defaultBuildingId] : [],
  );

  for (const apartmentId of apartmentsOf(resident)) {
    const apartment = await deps.repository.findApartment(apartmentId);

    if (apartment) houses.add(apartment.buildingId);
  }

  if (houses.size < 2) return undefined;

  const building = await deps.repository.findBuilding(buildingId);

  return building?.address || building?.code;
};

/**
 * Дома, о которых человеку положено знать: свой и, у смены, рабочий.
 * Сотрудник, который живёт в другом доме, видит и собрания своего дома,
 * и собрания дома, где ведёт смену.
 */
export const housesOf = async (deps: AppDeps, resident: Resident): Promise<string[]> => {
  const houses = new Set<string>([await homeBuildingOf(deps, resident)]);

  if (isCompanyStaff(resident.role)) houses.add(resident.buildingId ?? deps.defaultBuildingId);

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
 * Организация дома. Дома без владельца составляют один общий парк.
 */
const companyOf = (building?: Building): string => building?.companyId ?? '';

/** Дома, доступные человеку. */
export const listServedBuildings = async (deps: AppDeps, resident: Resident): Promise<ServedBuilding[]> => {
  const currentId = resident.buildingId ?? deps.defaultBuildingId;
  const own = await deps.repository.findBuilding(currentId);

  if (!isCompanyStaff(resident.role)) return own ? [describe(own, currentId)] : [];

  const granted = new Set(servedBy(resident, deps));
  const company = companyOf(own);

  return (await deps.repository.listBuildings())
    .filter((building) => companyOf(building) === company || granted.has(building.id))
    .sort((left, right) => left.code.localeCompare(right.code, 'ru'))
    .map((building) => describe(building, currentId));
};

/**
 * Дом в границах человека: свой, отданный вручную или дом той же организации.
 * Жильцу доступен только его собственный.
 */
export const servesBuilding = async (deps: AppDeps, resident: Resident, buildingId: string): Promise<boolean> => {
  const currentId = resident.buildingId ?? deps.defaultBuildingId;

  if (buildingId === currentId) return true;

  if (!isCompanyStaff(resident.role)) {
    const apartment = await apartmentIn(deps, resident, buildingId);

    return apartment !== undefined;
  }

  if (servedBy(resident, deps).includes(buildingId)) return true;

  const building = await deps.repository.findBuilding(buildingId);

  if (!building) return false;

  return companyOf(building) === companyOf(await deps.repository.findBuilding(currentId));
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
  const currentId = resident.buildingId ?? deps.defaultBuildingId;

  if (!buildingId || buildingId === currentId) return resident;

  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'Чужой дом видят только сотрудники управляющей компании');
  }

  if (!(await deps.repository.findBuilding(buildingId))) {
    throw new DomainError('building_not_found', 'Дом не найден');
  }

  if (!(await servesBuilding(deps, resident, buildingId))) {
    throw new DomainError('forbidden', 'Дом обслуживает другая управляющая организация');
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
  const house = buildingId ?? (await homeBuildingOf(deps, resident));

  await assertServes(deps, resident, house);

  const building = await deps.repository.findBuilding(house);
  const duty = (await deps.repository.listStaff(house)).find((person) => person.onDuty === true);

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
