import { DomainError, isCompanyStaff, type Role } from '@domovoy/domain';

import { apartmentsOf } from './apartments.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Роли, которые проверяющий примеряет на себя. */
export const DEMO_ROLES: readonly Role[] = ['resident', 'dispatcher', 'technician', 'manager', 'contractor'];

export interface DemoRole {
  role: Role;
  title: string;
  /** Что видно в этой роли: подпись под пунктом. */
  about: string;
  current: boolean;
}

const TITLES: Readonly<Record<Role, { title: string; about: string }>> = {
  resident: { title: 'Жилец', about: 'Заявки, показания, квитанция, собрания' },
  dispatcher: { title: 'Диспетчер', about: 'Очередь дома, назначение мастера, рассылка' },
  technician: { title: 'Мастер', about: 'Наряды, отчёт о работе, осмотры' },
  manager: { title: 'Управляющий', about: 'Дома компании, журнал действий, импорт' },
  contractor: { title: 'Подрядчик', about: 'Только порученные наряды' },
};

/** Список ролей для переключения: текущая отмечена. */
export const demoRoles = (resident: Resident): DemoRole[] =>
  DEMO_ROLES.map((role) => ({ role, ...TITLES[role], current: resident.role === role }));

/**
 * Примерка роли на проверке. Роль меняется у самого человека, поэтому дальше он
 * видит продукт ровно так, как видит её настоящий сотрудник или жилец.
 * @throws {DomainError}
 */
export const takeDemoRole = async (deps: AppDeps, resident: Resident, role: Role): Promise<Resident> => {
  if (!DEMO_ROLES.includes(role)) throw new DomainError('forbidden', 'Такой роли нет');

  const house = resident.buildingId ?? deps.defaultBuildingId;
  const next: Resident = { ...resident, role, buildingId: house };

  // Сотрудник ведёт дом, жилец живёт в квартире: без привязки половина экранов пуста.
  if (isCompanyStaff(role) || role === 'contractor') {
    next.servesBuildingIds = [house];
  } else if (apartmentsOf(resident).length === 0) {
    const free = (await deps.repository.listApartments(house))[0];

    if (free) {
      next.apartmentId = free.id;
      next.apartmentIds = [free.id];
    }
  }

  return deps.repository.saveResident(next);
};
