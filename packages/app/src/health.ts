import { DomainError, encodeTarget, isCompanyStaff, isWearDue, wearOf, type ServiceRequest } from '@domovoy/domain';

import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

export interface EquipmentHealth {
  code: string;
  /** Код объекта: тот же, что на наклейке. */
  startParam: string;
  title: string;
  /** Сколько раз о нём сообщали. */
  failures: number;
  /** Когда сломалось в последний раз. */
  lastAt?: Date;
  /** Средний промежуток между поломками в днях. Пусто, если поломка одна. */
  averageDays?: number;
  /** Через сколько дней ждать следующую по этому среднему. */
  dueInDays?: number;
  /** Открытая заявка по этому оборудованию есть прямо сейчас. */
  broken: boolean;
}

const OPEN = ['new', 'accepted', 'in_progress', 'needs_info', 'done'];

/** За сколько дней до расчётной поломки о ней стоит сказать смене. */
export const WEAR_WARNING_DAYS = 7;

/** Что скоро сломается по своей истории. Уже сломанное сюда не входит. */
export const dueSoon = (health: readonly EquipmentHealth[]): EquipmentHealth[] =>
  health.filter((item) => !item.broken && isWearDue(item, WEAR_WARNING_DAYS));

/** Здоровье оборудования дома. @throws {DomainError} если смотреть на чужой дом. */
export const equipmentHealth = async (deps: AppDeps, resident: Resident): Promise<EquipmentHealth[]> => {
  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'Обслуживание оборудования ведёт управляющая компания');
  }

  return resident.buildingId ? equipmentHealthOf(deps, resident.buildingId) : [];
};

/** То же самое по дому целиком, без проверки прав. */
export const equipmentHealthOf = async (deps: AppDeps, buildingId: string): Promise<EquipmentHealth[]> => {
  const equipment = await deps.repository.listEquipment(buildingId);
  const requests = await deps.repository.listRequests({ buildingId });
  const now = deps.now();

  const byEquipment = new Map<string, ServiceRequest[]>();

  for (const request of requests) {
    if (request.target.kind !== 'equipment') continue;

    const list = byEquipment.get(request.target.equipmentId) ?? [];

    list.push(request);
    byEquipment.set(request.target.equipmentId, list);
  }

  const health = equipment.map((item) => {
    const own = (byEquipment.get(item.code) ?? []).sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );
    const moments = own.map((request) => request.createdAt);
    const last = moments.at(-1);

    return {
      code: item.code,
      startParam: encodeTarget({ kind: 'equipment', buildingId, equipmentId: item.code, title: item.title }),
      title: item.title,
      failures: own.length,
      ...(last ? { lastAt: last } : {}),
      ...wearOf(moments, now),
      broken: own.some((request) => OPEN.includes(request.status)),
    };
  });

  return health.sort((left, right) => {
    if (left.broken !== right.broken) return left.broken ? -1 : 1;

    const leftDue = left.dueInDays ?? Number.POSITIVE_INFINITY;
    const rightDue = right.dueInDays ?? Number.POSITIVE_INFINITY;

    if (leftDue !== rightDue) return leftDue - rightDue;

    return right.failures - left.failures;
  });
};
