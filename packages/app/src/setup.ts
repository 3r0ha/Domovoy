import {
  DomainError,
  DEFAULT_TIME_ZONE,
  VISIT_MINUTES,
  checkReception,
  checkVisitMinutes,
  isHandoffTarget,
  type EquipmentKind,
  type ReceptionWindow,
} from '@domovoy/domain';

import { recordAction } from './audit.js';
import { BOM } from './csv.js';
import type { Building, Equipment, HouseContact, HousePartner, HouseService, Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Назначает управляющего: без указания дома в первый попавшийся. */
export const makeManager = async (
  deps: AppDeps,
  maxUserId: number,
  displayName?: string,
  buildingId?: string,
): Promise<Resident> => {
  const home = buildingId ?? (await deps.repository.listBuildings())[0]?.id;
  const existing = await deps.repository.findResidentByMaxUserId(maxUserId);

  const resident: Resident = existing
    ? { ...existing, role: 'manager', ...(buildingId ? { buildingId } : {}) }
    : {
        id: deps.createId(),
        maxUserId,
        displayName: displayName ?? 'Управляющий',
        role: 'manager',
        ...(home ? { buildingId: home } : {}),
      };

  return deps.repository.saveResident(resident);
};

/** Первый дом установки: его заводит оператор, а не управляющий. */
export const addBuilding = async (
  deps: AppDeps,
  card: BuildingCard & { code: string; companyId?: string },
): Promise<Building> => {
  if (card.timeZone && !isKnownZone(card.timeZone)) {
    throw new DomainError('time_zone_invalid', `Часовой пояс «${card.timeZone}» не опознан`);
  }

  const known = (await deps.repository.listBuildings()).find(
    (building) => building.code === card.code && (building.companyId ?? '') === (card.companyId ?? ''),
  );

  if (known) throw new DomainError('building_exists', `Дом с кодом ${card.code} у этой организации уже есть`);

  const building: Building = {
    id: deps.createId(),
    code: card.code,
    address: card.address?.trim() ?? '',
    timeZone: card.timeZone || DEFAULT_TIME_ZONE,
    ...(card.managementCompany?.trim() ? { managementCompany: card.managementCompany.trim() } : {}),
    ...(card.companyId ? { companyId: card.companyId } : {}),
    ...contactOf(card),
    ...serviceOf(card),
    ...receptionOf(card),
  };

  await deps.repository.saveBuilding(building);

  return building;
};

export interface BuildingCard {
  code?: string;
  address?: string;
  managementCompany?: string;
  /** Часовой пояс по IANA: от него зависят окно подачи и месяц начисления. */
  timeZone?: string;
  /** Ответственный по дому. Пустое имя убирает контакт. */
  contact?: HouseContact;
  /** Телефоны, режим работы и адрес приёма. Пустое поле убирает значение. */
  service?: HouseService;
  /** Приёмные окна. Пустой список означает, что приём по записи не ведётся. */
  reception?: ReceptionWindow[];
  /** Сколько минут занимает один приём. */
  visitMinutes?: number;
  /** Смежные организации дома. Пустой список убирает их все. */
  partners?: HousePartner[];
}

/** Смежные организации в карточке: заданный список заменяет прежний целиком. */
const partnersOf = (card: BuildingCard, known?: Building): Pick<Building, 'partners'> => {
  const partners = card.partners === undefined ? known?.partners : checkPartners(card.partners);

  return partners?.length ? { partners } : {};
};

/** Организация без названия в карточке не держится. @throws {DomainError} */
const checkPartners = (partners: HousePartner[]): HousePartner[] =>
  partners
    .map((partner) => ({ ...partner, title: partner.title.trim() }))
    .filter((partner) => partner.title.length > 0)
    .map((partner) => {
      if (!isHandoffTarget(partner.kind)) {
        throw new DomainError('partner_unknown', 'Зона организации не опознана');
      }

      return partner;
    });

/** Приём в карточке: заданный заменяет прежний, пустой убирает, отсутствующий оставляет. */
const receptionOf = (
  card: BuildingCard,
  known?: Building,
): Pick<Building, 'reception' | 'visitMinutes'> => {
  const windows = card.reception === undefined ? known?.reception : checkReception(card.reception);
  const minutes = card.visitMinutes ?? known?.visitMinutes;

  if (minutes !== undefined) checkVisitMinutes(minutes);

  return {
    ...(windows?.length ? { reception: windows } : {}),
    ...(windows?.length ? { visitMinutes: minutes ?? VISIT_MINUTES } : {}),
  };
};

/** Поля обслуживания: заданное заменяет прежнее, пустое убирает, отсутствующее оставляет. */
const serviceOf = (card: BuildingCard, known?: Building): { service?: HouseService } => {
  if (card.service === undefined) return known?.service ? { service: known.service } : {};

  const merged: HouseService = { ...known?.service };

  for (const [key, value] of Object.entries(card.service) as [keyof HouseService, string | undefined][]) {
    const clean = value?.trim();

    if (clean) merged[key] = clean;
    else delete merged[key];
  }

  if (merged.email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(merged.email)) {
    throw new DomainError('email_invalid', 'Почта не похожа на адрес');
  }

  return Object.keys(merged).length > 0 ? { service: merged } : {};
};

/** Контакт в карточке: заданный заменяет прежний, пустой убирает, отсутствующий оставляет. */
const contactOf = (card: BuildingCard, known?: Building): { contact?: HouseContact } => {
  if (card.contact === undefined) return known?.contact ? { contact: known.contact } : {};

  const contact = cleanContact(card.contact);

  return contact ? { contact } : {};
};

/** Имя обязательно, остальное по желанию. Пустой контакт означает «убрать». */
const cleanContact = (contact: HouseContact | undefined): HouseContact | undefined => {
  const name = contact?.name.trim();

  if (!contact || !name) return undefined;

  const role = contact.role?.trim();
  const phone = contact.phone?.trim();
  const email = contact.email?.trim();

  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    throw new DomainError('email_invalid', 'Почта не похожа на адрес');
  }

  return {
    name,
    ...(role ? { role } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
  };
};

/**
 * Ещё один дом в парке компании: заводит управляющий, владелец наследуется
 * от его дома. @throws {DomainError}
 */
export const openBuilding = async (
  deps: AppDeps,
  manager: Resident,
  card: BuildingCard & { code: string },
): Promise<Building> => {
  if (manager.role !== 'manager') throw new DomainError('forbidden', 'Дома заводит управляющий');

  const own = await deps.repository.findBuilding(manager.buildingId ?? deps.defaultBuildingId);

  const building = await addBuilding(deps, {
    ...card,
    ...(own?.companyId ? { companyId: own.companyId } : {}),
    ...(card.managementCompany?.trim() || own?.managementCompany
      ? { managementCompany: card.managementCompany?.trim() || own?.managementCompany }
      : {}),
    timeZone: card.timeZone || own?.timeZone || DEFAULT_TIME_ZONE,
  });

  await deps.repository.saveResident({
    ...manager,
    servesBuildingIds: [...new Set([...(manager.servesBuildingIds ?? []), building.id])],
  });

  await recordAction(deps, {
    actor: manager,
    action: 'building_added',
    subject: building.address || building.code,
    ...(own ? { buildingId: own.id } : {}),
  });

  return building;
};

/** Карточка дома: адрес, код для номеров заявок и часовой пояс. @throws {DomainError} */
export const updateBuilding = async (deps: AppDeps, manager: Resident, card: BuildingCard): Promise<Building> => {
  if (manager.role !== 'manager') throw new DomainError('forbidden', 'Карточку дома ведёт управляющий');

  const buildingId = manager.buildingId ?? deps.defaultBuildingId;
  const known = await deps.repository.findBuilding(buildingId);

  if (card.timeZone && !isKnownZone(card.timeZone)) {
    throw new DomainError('time_zone_invalid', `Часовой пояс «${card.timeZone}» не опознан`);
  }

  const building: Building = {
    id: buildingId,
    code: card.code?.trim() || known?.code || 'Д1',
    address: card.address?.trim() || known?.address || '',
    ...(card.managementCompany?.trim() || known?.managementCompany
      ? { managementCompany: card.managementCompany?.trim() || known?.managementCompany }
      : {}),
    timeZone: card.timeZone || known?.timeZone || DEFAULT_TIME_ZONE,
    ...(known?.chatId === undefined ? {} : { chatId: known.chatId }),
    ...(known?.companyId === undefined ? {} : { companyId: known.companyId }),
    ...contactOf(card, known),
    ...serviceOf(card, known),
    ...receptionOf(card, known),
    ...partnersOf(card, known),
  };

  await deps.repository.saveBuilding(building);

  await recordAction(deps, {
    actor: manager,
    action: 'building_updated',
    subject: building.address || building.code,
    buildingId,
  });

  return building;
};

/** Привязать чат дома: общедомовые объявления попадут и туда. @throws {DomainError} */
export const bindHouseChat = async (deps: AppDeps, manager: Resident, chatId: number): Promise<Building> => {
  if (manager.role !== 'manager') throw new DomainError('forbidden', 'Чат дома привязывает управляющий');

  const buildingId = manager.buildingId ?? deps.defaultBuildingId;
  const known = await deps.repository.findBuilding(buildingId);

  if (!known) throw new DomainError('building_not_found', 'Дом не найден');

  const taken = await buildingByChat(deps, chatId);

  if (taken && taken.id !== buildingId) {
    throw new DomainError('chat_taken', `Этот чат уже привязан к дому ${taken.address || taken.code}`);
  }

  const building: Building = { ...known, chatId };

  await deps.repository.saveBuilding(building);

  await recordAction(deps, {
    actor: manager,
    action: 'building_updated',
    subject: `чат дома ${building.address || building.code}`,
    buildingId,
  });

  return building;
};

/** Какому дому принадлежит чат: по нему определяется адрес заявки из общего чата. */
export const buildingByChat = async (deps: AppDeps, chatId: number): Promise<Building | undefined> => {
  const buildings = await deps.repository.listBuildings();

  return buildings.find((building) => building.chatId === chatId);
};

/** Бота выгнали из чата: привязка дома к нему снимается. */
export const unbindHouseChat = async (deps: AppDeps, chatId: number): Promise<Building | undefined> => {
  const building = await buildingByChat(deps, chatId);

  if (!building) return undefined;

  await deps.repository.saveBuilding(withoutChat(building));

  return withoutChat(building);
};

/** Отвязка чата из приложения, без выгона бота. @throws {DomainError} */
export const releaseHouseChat = async (deps: AppDeps, manager: Resident): Promise<Building> => {
  if (manager.role !== 'manager') throw new DomainError('forbidden', 'Чат дома отвязывает управляющий');

  const buildingId = manager.buildingId ?? deps.defaultBuildingId;
  const known = await deps.repository.findBuilding(buildingId);

  if (!known) throw new DomainError('building_not_found', 'Дом не найден');
  if (known.chatId === undefined) return known;

  const building = withoutChat(known);

  await deps.repository.saveBuilding(building);

  await recordAction(deps, {
    actor: manager,
    action: 'building_updated',
    subject: `чат дома ${building.address || building.code} отвязан`,
    buildingId,
  });

  return building;
};

const withoutChat = (building: Building): Building => {
  const { chatId, ...rest } = building;
  void chatId;

  return rest;
};

const isKnownZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const KINDS: Record<string, EquipmentKind> = {
  лифт: 'lift',
  домофон: 'intercom',
  шлагбаум: 'barrier',
  'узел учёта': 'meter_unit',
  'узел учета': 'meter_unit',
};

export interface EquipmentImport {
  added: number;
  problems: { line: number; message: string }[];
}

/** Оборудование дома списком: код с наклейки, название и вид. @throws {DomainError} */
export const importEquipment = async (deps: AppDeps, manager: Resident, csv: string): Promise<EquipmentImport> => {
  if (manager.role !== 'manager') throw new DomainError('forbidden', 'Оборудование заводит управляющий');

  const buildingId = manager.buildingId ?? deps.defaultBuildingId;
  const lines = csv.replace(BOM, '').split(/\r?\n/);
  const problems: EquipmentImport['problems'] = [];
  let added = 0;

  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;

    const [code, title, kind] = line.split(line.includes(';') ? ';' : ',').map((cell) => cell.trim());
    const at = index + 1;

    if (index === 0 && /код/i.test(code ?? '')) continue;

    if (!code || !title) {
      problems.push({ line: at, message: 'Нужны код и название' });
      continue;
    }

    const known = kind ? KINDS[kind.toLowerCase()] : undefined;

    if (kind && !known) {
      problems.push({ line: at, message: `Вид «${kind}» не опознан: лифт, домофон, шлагбаум, узел учёта` });
      continue;
    }

    const equipment: Equipment = { buildingId, code, title, ...(known ? { kind: known } : {}) };

    await deps.repository.saveEquipment(equipment);
    added += 1;
  }

  if (added > 0) {
    await recordAction(deps, {
      actor: manager,
      action: 'data_imported',
      subject: `${added} единиц оборудования`,
      buildingId,
    });
  }

  return { added, problems };
};

/** Пример файла с оборудованием. */
export const EQUIPMENT_TEMPLATE = ['Код;Название;Вид', 'lift-1;Лифт, подъезд 1;лифт', 'uzel-1;Узел учёта;узел учёта'].join(
  '\n',
);
