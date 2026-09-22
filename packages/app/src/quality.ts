import { DomainError, lastDays, previousPeriod, summarize, summarizePeriod } from '@domovoy/domain';
import type { Translate } from '@domovoy/i18n';

import { homeBuildingOf } from './buildings.js';
import { counted, speakDefault } from './language.js';
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
 * Работа управляющей организации глазами жильца. Те же числа, что и в сводке
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
export const formatQualityShort = (quality: HouseQuality, t: Translate = speakDefault()): string => {
  const rate =
    quality.inTimeRate === undefined
      ? ''
      : t('app.quality.rateShort', {
          доля: `${Math.round(quality.inTimeRate * 100)}%`,
          дни: counted(t, 'days', quality.days),
        });

  const overdue = quality.overdue > 0 ? t('app.quality.overdueShort', { сколько: quality.overdue }) : '';

  return t('app.quality.short', { открыто: quality.open, просрочено: overdue, срок: rate });
};

/** Работа дома словами. */
export const formatQuality = (quality: HouseQuality, t: Translate = speakDefault()): string => {
  const дни = counted(t, 'days', quality.days);
  const lines = [
    quality.address
      ? t('app.quality.titleAt', { дни, адрес: quality.address })
      : t('app.quality.title', { дни }),
    '',
    t('app.quality.created', { сколько: quality.created }),
    t('app.quality.closed', { сколько: quality.closed }),
  ];

  if (quality.inTimeRate !== undefined) {
    lines.push(t('app.quality.inTime', { доля: `${Math.round(quality.inTimeRate * 100)}%` }));
  }

  if (quality.averageHours !== undefined) {
    const earlier = quality.before?.averageHours;
    const часы = Math.round(quality.averageHours);

    lines.push(
      earlier === undefined
        ? t('app.quality.hours', { часы })
        : t('app.quality.hoursBefore', { часы, раньше: Math.round(earlier) }),
    );
  }

  if (quality.averageRating !== undefined) {
    lines.push(t('app.quality.rating', { оценка: quality.averageRating, сколько: quality.rated }));
  }

  lines.push(
    '',
    quality.overdue > 0
      ? t('app.quality.openOverdue', { сколько: quality.open, просрочено: quality.overdue })
      : t('app.quality.open', { сколько: quality.open }),
  );

  return lines.join('\n');
};
