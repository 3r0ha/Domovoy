import { DomainError, isCompanyStaff } from '@domovoy/domain';

import { recordAction } from './audit.js';
import { servedBy } from './buildings.js';
import { noopNotifier, notifyResident } from './notifier.js';
import type { Building, Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

export interface HandOverCommand {
  /** Кто передаёт: управляющий организации, которая ведёт дом сейчас. */
  manager: Resident;
  buildingId: string;
  /** Название организации, которая принимает дом. */
  company: string;
  /**
   * Кто станет управляющим новой организации. Человек уже должен быть
   * в продукте: обычно это её сотрудник, зашедший в приложение как житель.
   */
  managerId: string;
  /**
   * Название организации, которая ведёт дом сейчас. Им подтверждают, что
   * передают именно этот дом. Пусто означает, что подтверждения не требуют.
   */
  current?: string;
}

export interface HandOverResult {
  buildingId: string;
  company: string;
  /** Новый управляющий. */
  manager: Resident;
  /** Сколько сотрудников прежней организации отвязано от дома. */
  released: number;
  /** Скольким жильцам ушло сообщение о смене. */
  notified: number;
  /** Чат дома остался привязан: новая организация пишет в него сразу. */
  chatKept: boolean;
}

/**
 * Передача разрушительна и рассылает сообщение каждому жильцу, поэтому нынешнюю
 * организацию называют вслух. Проверка идёт после прав: чужому человеку
 * отвечают отказом, а не подсказкой, какое поле заполнить. @throws {DomainError}
 */
const assertConfirmed = (current: string | undefined, building: Building): void => {
  if (current === undefined || current === (building.managementCompany ?? '')) return;

  throw new DomainError(
    'wrong_object',
    'Подтвердите передачу: укажите название организации, которая ведёт дом сейчас',
  );
};

/** Дом остался у сотрудника, если он ведёт и другие дома этой же организации. */
const withoutBuilding = (resident: Resident, buildingId: string): Resident => {
  const rest = (resident.servesBuildingIds ?? []).filter((id: string) => id !== buildingId);

  return { ...resident, servesBuildingIds: rest };
};

/**
 * Передача дома другой управляющей организации. Дом живёт дольше договора
 * управления: чат, заявки, показания и собрания остаются у дома, а меняется
 * только организация и люди, которые его ведут. Новая компания получает дом
 * вместе с чатом, а не начинает переписку заново.
 *
 * @throws {DomainError}
 */
export const handOverBuilding = async (deps: AppDeps, command: HandOverCommand): Promise<HandOverResult> => {
  if (command.manager.role !== 'manager') {
    throw new DomainError('forbidden', 'Дом передаёт управляющий организации, которая ведёт его сейчас');
  }

  if (!servedBy(command.manager, deps).includes(command.buildingId)) {
    throw new DomainError('forbidden', 'Этот дом ведёт другая управляющая организация');
  }

  const company = command.company.trim();

  if (company.length === 0) {
    throw new DomainError('description_required', 'Назовите организацию, которая принимает дом');
  }

  const building = await deps.repository.findBuilding(command.buildingId);

  if (!building) throw new DomainError('building_not_found', 'Дом не найден');

  assertConfirmed(command.current, building);

  const heir = await deps.repository.findResident(command.managerId);

  if (!heir) throw new DomainError('resident_unknown', 'Человек не найден');

  // Дом принадлежит организации по companyId: пока он прежний, сотрудники
  // старой компании видят дом как свой, сколько их от него ни отвязывай.
  const heirHouse = heir.buildingId ? await deps.repository.findBuilding(heir.buildingId) : undefined;
  const inherited = heirHouse?.companyId;
  const companyId = inherited !== undefined && inherited !== building.companyId ? inherited : deps.createId();

  await deps.repository.saveBuilding({ ...building, managementCompany: company, companyId });

  // Сотрудники прежней организации теряют дом. Тот, у кого домов больше
  // не осталось, перестаёт быть сотрудником: чужие заявки ему не видны.
  const staff = await deps.repository.listStaff(command.buildingId);
  let released = 0;

  for (const person of staff) {
    if (person.id === heir.id) continue;

    const detached = withoutBuilding(person, command.buildingId);
    const homeless = (detached.servesBuildingIds ?? []).length === 0 && person.buildingId === command.buildingId;

    await deps.repository.saveResident({
      ...detached,
      ...(homeless ? { role: 'resident', onDuty: false } : {}),
    });

    released += 1;
  }

  const manager = await deps.repository.saveResident({
    ...heir,
    role: 'manager',
    buildingId: command.buildingId,
    servesBuildingIds: [...new Set([...(heir.servesBuildingIds ?? []), command.buildingId])],
  });

  await recordAction(deps, {
    actor: command.manager,
    action: 'building_handed_over',
    subject: building.address,
    details: `${company}, управляющий ${manager.displayName}`,
    buildingId: command.buildingId,
  });

  // Жильцы узнают о смене от продукта: иначе первое сообщение новой компании
  // выглядит как чужое.
  const apartments = await deps.repository.listApartments(command.buildingId);
  const residents = await deps.repository.listResidentsByApartments(apartments.map((apartment) => apartment.id));
  const notifier = deps.notifier ?? noopNotifier;
  let notified = 0;

  for (const person of residents) {
    if (isCompanyStaff(person.role)) continue;

    await notifyResident(
      notifier,
      person,
      `Дом ${building.address} обслуживает другая управляющая организация: ${company}.\n` +
        'Заявки, показания и переписка остаются здесь же.',
    );

    notified += 1;
  }

  return {
    buildingId: command.buildingId,
    company,
    manager,
    released,
    notified,
    chatKept: building.chatId !== undefined,
  };
};
