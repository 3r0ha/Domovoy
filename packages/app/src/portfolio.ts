import { DomainError, createdIn, isCompanyStaff, lastDays, summarize, summarizePeriod } from '@domovoy/domain';

import { listServedBuildings } from './buildings.js';
import type { Resident } from './repository.js';
import { DEFAULT_REPORT_DAYS } from './report.js';
import type { AppDeps } from './use-cases.js';

export interface BuildingLine {
  buildingId: string;
  code: string;
  address: string;
  /** Открыто сейчас. */
  open: number;
  /** Из открытых те, у которых нарушен срок. */
  overdue: number;
  /** Подано за период. */
  created: number;
  /** Доля закрытых в срок, 0…1. Пусто, если за период ничего не закрывали. */
  inTimeRate?: number;
  /** Средняя оценка жильцов, 1…5. Пусто, если не оценивали. */
  averageRating?: number;
}

/** Дома компании в одном списке, худшие сверху. @throws {DomainError} */
export const portfolio = async (
  deps: AppDeps,
  resident: Resident,
  days: number = DEFAULT_REPORT_DAYS,
): Promise<BuildingLine[]> => {
  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'Список домов доступен сотрудникам управляющей компании');
  }

  const now = deps.now();
  const period = lastDays(now, days);
  const served = await listServedBuildings(deps, resident);
  const lines: BuildingLine[] = [];

  for (const building of served) {
    const requests = await deps.repository.listRequests({ buildingId: building.id });
    const state = summarize(requests, now);
    const inPeriod = summarizePeriod(requests, period, now);

    lines.push({
      buildingId: building.id,
      code: building.code,
      address: building.address,
      open: state.open,
      overdue: state.overdue,
      created: createdIn(requests, period).length,
      ...(inPeriod.closed > 0 ? { inTimeRate: inPeriod.inTimeRate } : {}),
      ...(inPeriod.rated > 0 ? { averageRating: inPeriod.averageRating } : {}),
    });
  }

  return lines.sort((left, right) => right.overdue - left.overdue || right.open - left.open);
};
