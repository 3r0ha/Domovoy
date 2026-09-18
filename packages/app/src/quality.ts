import { DomainError, lastDays, previousPeriod, summarize, summarizePeriod } from '@domovoy/domain';

import { homeBuildingOf } from './buildings.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Как дом работал за период. */
export interface HouseQuality {
  buildingId: string;
  /**
   * Адрес этого дома. У сотрудника, который живёт в другом доме, здесь его
   * собственный дом, а не дом смены, и адрес отличает одни числа от других.
   */
  address?: string;
  /** Сколько суток считалось. */
  days: number;
  from: Date;
  to: Date;
  /** Сколько заявок дома открыто прямо сейчас. */
  open: number;
  /** Из них с нарушенным сроком. */
  overdue: number;
  /** Подано за период. */
  created: number;
  /** Закрыто за период. */
  closed: number;
  /** Доля закрытых в срок, 0…1. Без единой закрытой заявки её нет. */
  inTimeRate?: number;
  /** Среднее время от обращения до сдачи работы, в часах. */
  averageHours?: number;
  /** Средняя оценка жильцов, 1…5. Без единой оценки её нет. */
  averageRating?: number;
  /** Сколько закрытых заявок жильцы оценили. */
  rated: number;
  /** Те же числа за такой же промежуток перед ним. */
  before?: { closed: number; inTimeRate?: number; averageHours?: number };
}

/** За какой срок жилец смотрит работу дома. */
export const QUALITY_DAYS = 30;

/**
 * Работа управляющей компании глазами жильца. Те же числа, что и в сводке
 * для сотрудников, но без разрезов по людям.
 */
export const houseQuality = async (
  deps: AppDeps,
  resident: Resident,
  days: number = QUALITY_DAYS,
): Promise<HouseQuality> => {
  const buildingId = await homeBuildingOf(deps, resident);

  if (!buildingId) throw new DomainError('building_unknown', 'Дом не определён');

  const now = deps.now();
  const requests = await deps.repository.listRequests({ buildingId });
  const period = lastDays(now, days);
  const state = summarize(requests, now);
  const worked = summarizePeriod(requests, period, now);
  const earlier = summarizePeriod(requests, previousPeriod(period), now);

  const building = await deps.repository.findBuilding(buildingId);

  return {
    buildingId,
    ...(building?.address ? { address: building.address } : {}),
    days,
    from: period.from,
    to: period.to,
    open: state.open,
    overdue: state.overdue,
    created: worked.created,
    closed: worked.closed,
    rated: worked.rated,
    ...(worked.closed > 0 ? { inTimeRate: worked.inTimeRate, averageHours: worked.averageHours } : {}),
    ...(worked.rated > 0 ? { averageRating: worked.averageRating } : {}),
    ...(earlier.closed > 0
      ? { before: { closed: earlier.closed, inTimeRate: earlier.inTimeRate, averageHours: earlier.averageHours } }
      : {}),
  };
};

/**
 * Работа дома одной строкой. Столбик цифр читают на экране, в переписке от него
 * остаётся главное: сколько сейчас открыто и как компания держит сроки.
 */
export const formatQualityShort = (quality: HouseQuality): string => {
  const rate =
    quality.inTimeRate === undefined ? '' : `, в срок ${Math.round(quality.inTimeRate * 100)}% за ${quality.days} дней`;

  const overdue = quality.overdue > 0 ? `, просрочено ${quality.overdue}` : '';

  return `Сейчас открыто заявок: ${quality.open}${overdue}${rate}.`;
};

/** Работа дома словами. */
export const formatQuality = (quality: HouseQuality): string => {
  const where = quality.address ? `, ${quality.address}` : '';
  const lines = [`Как работает управляющая компания за ${quality.days} дней${where}:`, ''];

  lines.push(`  Подано заявок: ${quality.created}`);
  lines.push(`  Закрыто: ${quality.closed}`);

  if (quality.inTimeRate !== undefined) {
    lines.push(`  В срок: ${Math.round(quality.inTimeRate * 100)}%`);
  }

  if (quality.averageHours !== undefined) {
    const earlier = quality.before?.averageHours;
    const was = earlier === undefined ? '' : `, месяцем раньше ${Math.round(earlier)} ч`;

    lines.push(`  Среднее время работы: ${Math.round(quality.averageHours)} ч${was}`);
  }

  if (quality.averageRating !== undefined) {
    lines.push(`  Оценка жильцов: ${quality.averageRating} из 5 (оценили ${quality.rated})`);
  }

  lines.push('', `Сейчас открыто заявок: ${quality.open}${quality.overdue > 0 ? `, просрочено ${quality.overdue}` : ''}`);

  return lines.join('\n');
};
