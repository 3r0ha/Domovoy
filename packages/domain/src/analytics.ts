import { describeTarget } from './audience.js';
import { CATEGORY_RULES, isOverdue, missedDeadline, settledAt } from './sla.js';
import { reportersCount } from './incident.js';
import { crossedIn } from './numbers.js';
import { OPEN_STATUSES, isFinal, statusChanges } from './status.js';
import type { RequestCategory, RequestStatus, RequestTarget, ServiceRequest } from './types.js';

/** Сводка по дому. */
export interface BuildingSummary {
  total: number;
  open: number;
  overdue: number;
  /** Закрыты жильцом: работа принята. */
  confirmed: number;
  rejected: number;
  /** Сколько обращений сэкономила склейка: подтверждения вместо новых заявок. */
  mergedReports: number;
}

export const summarize = (requests: readonly ServiceRequest[], now: Date): BuildingSummary => {
  let open = 0;
  let overdue = 0;
  let confirmed = 0;
  let rejected = 0;
  let mergedReports = 0;

  for (const request of requests) {
    if (OPEN_STATUSES.includes(request.status)) open += 1;
    if (isOverdue(request, now)) overdue += 1;
    if (request.status === 'confirmed') confirmed += 1;
    if (request.status === 'rejected') rejected += 1;

    mergedReports += request.joinedBy.length;
  }

  return { total: requests.length, open, overdue, confirmed, rejected, mergedReports };
};

/** Промежуток времени для отчёта. */
export interface Period {
  from: Date;
  to: Date;
}

/** Последние `days` суток, заканчивая текущим моментом. */
export const lastDays = (now: Date, days: number): Period => ({
  from: new Date(now.getTime() - days * 24 * 60 * 60_000),
  to: now,
});

const DAY_MS = 24 * 60 * 60_000;

/** Сколько заявок заводили в каждые сутки периода. Последнее число, текущие сутки. */
export const dailyLoad = (requests: readonly ServiceRequest[], period: Period): number[] => {
  const days = Math.max(1, Math.ceil((period.to.getTime() - period.from.getTime()) / DAY_MS));
  const counts = new Array<number>(days).fill(0);

  for (const request of requests) {
    const passed = request.createdAt.getTime() - period.from.getTime();

    if (passed < 0) continue;

    const index = Math.min(days - 1, Math.floor(passed / DAY_MS));

    counts[index]! += 1;
  }

  return counts;
};

/** Такой же по длине промежуток, стоящий сразу перед заданным: с ним и сравнивают. */
export const previousPeriod = (period: Period): Period => {
  const length = period.to.getTime() - period.from.getTime();

  return { from: new Date(period.from.getTime() - length), to: period.from };
};

const within = (at: Date, period: Period): boolean => crossedIn(at, period.from, period.to);

/** Итоги за период. */
export interface PeriodSummary {
  from: Date;
  to: Date;
  /** Подано за период. */
  created: number;
  /** Закрыто за период, независимо от того, когда было подано. */
  closed: number;
  /** Из закрытых, принято жильцом. */
  confirmed: number;
  /** Из закрытых, отклонено управляющей компанией. */
  rejected: number;
  /** Обращений, склеенных с уже открытыми заявками. */
  mergedReports: number;
  /** Доля закрытых, уложившихся в норматив, 0…1. */
  inTimeRate: number;
  /** Среднее время от подачи до сдачи работы, в часах. */
  averageHours: number;
  /** Заявки, не уложившиеся в норматив. */
  missed: number;
  /** Сколько закрытых заявок жилец оценил. */
  rated: number;
  /** Средняя оценка жильцов за период, 1…5. */
  averageRating: number;
}

export const summarizePeriod = (
  requests: readonly ServiceRequest[],
  period: Period,
  now: Date,
): PeriodSummary => {
  let created = 0;
  let closed = 0;
  let confirmed = 0;
  let rejected = 0;
  let mergedReports = 0;
  let missed = 0;
  let hoursTotal = 0;
  let rated = 0;
  let ratingTotal = 0;

  for (const request of requests) {
    if (within(request.createdAt, period)) created += 1;

    mergedReports += request.joinedBy.filter((join) => within(join.at, period)).length;

    const settled = settledAt(request);

    if (!settled || !within(settled, period)) continue;

    closed += 1;
    hoursTotal += (settled.getTime() - request.createdAt.getTime()) / 3_600_000;

    if (request.status === 'confirmed') confirmed += 1;
    if (request.status === 'rejected') rejected += 1;
    if (missedDeadline(request, now)) missed += 1;

    if (request.rating) {
      rated += 1;
      ratingTotal += request.rating;
    }
  }

  return {
    from: period.from,
    to: period.to,
    created,
    closed,
    confirmed,
    rejected,
    mergedReports,
    inTimeRate: closed === 0 ? 1 : (closed - missed) / closed,
    averageHours: closed === 0 ? 0 : Math.round((hoursTotal / closed) * 10) / 10,
    missed,
    rated,
    averageRating: rated === 0 ? 0 : Math.round((ratingTotal / rated) * 10) / 10,
  };
};

/** Заявки, поданные в промежутке: с них считают разрезы отчёта за период. */
export const createdIn = (requests: readonly ServiceRequest[], period: Period): ServiceRequest[] =>
  requests.filter((request) => within(request.createdAt, period));

export interface AssigneeQuality {
  assigneeId: string;
  /** Сколько работ сдано: переходы в «выполнено». */
  completed: number;
  /** Сколько из них жилец не принял. */
  reopened: number;
  /** Доля непринятых работ, 0…1. */
  reopenRate: number;
  /** Сколько сдач подтверждено сканом наклейки у объекта. */
  onSite: number;
  /** Сколько заявок жилец оценил. */
  rated: number;
  /** Средняя оценка жильцов, 1…5. Ноль означает «не оценивали». */
  averageRating: number;
}

/** Качество работы исполнителей. */
export const assigneeQuality = (requests: readonly ServiceRequest[]): AssigneeQuality[] => {
  const stats = new Map<
    string,
    { completed: number; reopened: number; onSite: number; rated: number; ratingSum: number }
  >();

  const add = (
    assigneeId: string,
    change: { completed?: number; reopened?: number; onSite?: number; rating?: number },
  ): void => {
    const current = stats.get(assigneeId) ?? { completed: 0, reopened: 0, onSite: 0, rated: 0, ratingSum: 0 };
    const rating = change.rating ?? 0;

    stats.set(assigneeId, {
      completed: current.completed + (change.completed ?? 0),
      reopened: current.reopened + (change.reopened ?? 0),
      onSite: current.onSite + (change.onSite ?? 0),
      rated: current.rated + (rating > 0 ? 1 : 0),
      ratingSum: current.ratingSum + rating,
    });
  };

  for (const request of requests) {
    const changes = statusChanges(request);
    let current = changes.some((event) => event.assigneeId) ? undefined : request.assigneeId;
    let previous: RequestStatus | undefined;
    let lastCompleted: string | undefined;

    for (const event of changes) {
      if (event.assigneeId) current = event.assigneeId;

      if (event.status === 'done' && current) {
        add(current, { completed: 1, ...(event.onSite ? { onSite: 1 } : {}) });
        lastCompleted = current;
      }

      if (previous === 'done' && event.status === 'in_progress' && lastCompleted) {
        add(lastCompleted, { reopened: 1 });
      }

      previous = event.status;
    }

    if (request.rating && lastCompleted) add(lastCompleted, { rating: request.rating });
  }

  return [...stats]
    .map(([assigneeId, value]) => ({
      assigneeId,
      completed: value.completed,
      reopened: value.reopened,
      onSite: value.onSite,
      reopenRate: value.completed === 0 ? 0 : value.reopened / value.completed,
      rated: value.rated,
      averageRating: value.rated === 0 ? 0 : value.ratingSum / value.rated,
    }))
    .sort((left, right) => right.reopenRate - left.reopenRate);
};

export interface ProblemObject {
  target: RequestTarget;
  /** Как называть объект жильцу и в отчёте. */
  title: string;
  requests: number;
  /** Сколько раз работу по объекту не приняли. */
  reopened: number;
}

/** Начиная со скольких обращений объект попадает в отчёт. */
export const PROBLEM_OBJECT_THRESHOLD = 3;

const targetKey = (target: RequestTarget): string => {
  switch (target.kind) {
    case 'apartment':
      return `apartment:${target.apartmentId}`;
    case 'equipment':
      return `equipment:${target.buildingId}:${target.equipmentId}`;
    case 'riser':
      return `riser:${target.buildingId}:${target.entrance}:${target.riser}`;
    case 'entrance':
      return `entrance:${target.buildingId}:${target.entrance}`;
    case 'building':
      return `building:${target.buildingId}`;
  }
};

/** Объекты, которые ломаются чаще прочих. */
export const problemObjects = (
  requests: readonly ServiceRequest[],
  threshold: number = PROBLEM_OBJECT_THRESHOLD,
): ProblemObject[] => {
  const grouped = new Map<string, ProblemObject>();

  for (const request of requests) {
    const key = targetKey(request.target);
    const current = grouped.get(key) ?? {
      target: request.target,
      title: describeTarget(request.target),
      requests: 0,
      reopened: 0,
    };

    grouped.set(key, {
      ...current,
      requests: current.requests + 1,
      reopened: current.reopened + request.reopenCount,
    });
  }

  return [...grouped.values()]
    .filter((item) => item.requests >= threshold)
    .sort((left, right) => right.requests - left.requests);
};

export interface CategoryLoad {
  category: RequestCategory;
  title: string;
  total: number;
  /** Не уложились в норматив, включая те, что уже закрыты с нарушением. */
  overdue: number;
  /** Доля просроченных, 0…1: по ней видно, где норматив не выполняется. */
  overdueRate: number;
}

/** Где именно управляющая компания не укладывается в норматив. */
export const categoryLoad = (requests: readonly ServiceRequest[], now: Date): CategoryLoad[] => {
  const grouped = new Map<RequestCategory, { total: number; overdue: number }>();

  for (const request of requests) {
    const current = grouped.get(request.category) ?? { total: 0, overdue: 0 };

    grouped.set(request.category, {
      total: current.total + 1,
      overdue: current.overdue + (missedDeadline(request, now) ? 1 : 0),
    });
  }

  return [...grouped]
    .map(([category, value]) => ({
      category,
      title: CATEGORY_RULES[category].title,
      total: value.total,
      overdue: value.overdue,
      overdueRate: value.total === 0 ? 0 : value.overdue / value.total,
    }))
    .sort((left, right) => right.overdueRate - left.overdueRate || right.total - left.total);
};

export interface IncidentSummary {
  requestId: string;
  number: string;
  /** Суть заявки одной строкой. */
  title: string;
  /** Где случилось. */
  target: string;
  reporters: number;
}

/** Аварии, о которых сообщили несколько жильцов: их разбирают первыми. */
export const confirmedIncidents = (requests: readonly ServiceRequest[]): IncidentSummary[] =>
  requests
    .filter((request) => reportersCount(request) > 1 && !isFinal(request.status))
    .map((request) => ({
      requestId: request.id,
      number: request.number,
      title: request.title,
      target: describeTarget(request.target),
      reporters: reportersCount(request),
    }))
    .sort((left, right) => right.reporters - left.reporters);
