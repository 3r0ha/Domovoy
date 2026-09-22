import {
  STATUS_TITLES,
  CATEGORY_RULES,
  DEFAULT_TIME_ZONE,
  DomainError,
  isCompanyStaff,
  assigneeLoad,
  assigneeQuality,
  categoryLoad,
  confirmedIncidents,
  createdIn,
  dailyLoad,
  describeTarget,
  isInspectionOverdue,
  lastDays,
  missedDeadline,
  previousPeriod,
  problemObjects,
  reportersCount,
  settledAt,
  summarize,
  summarizePeriod,
  type AssigneeQuality,
  type BuildingSummary,
  type CategoryLoad,
  type IncidentSummary,
  type Inspection,
  type PeriodSummary,
  type ProblemObject,
} from '@domovoy/domain';

import { csvFrom, type Table } from './csv.js';
import type { ExportPeriod } from './export.js';
import type { Resident } from './repository.js';
import { zoneOf } from './zone.js';
import type { AppDeps } from './use-cases.js';

/** Исполнитель с именем вместо идентификатора. */
export interface NamedQuality extends AssigneeQuality {
  displayName: string;
}

export interface InspectionSummary {
  /** Закончено за период. */
  finished: number;
  /** Не закончено и срок вышел. */
  overdue: number;
  /** Заявок, вышедших из найденных недостатков. */
  found: number;
}

/** Осмотры за период: сделано, просрочено и что из них вышло. */
const countInspections = (
  inspections: readonly Inspection[],
  period: { from: Date; to: Date },
  now: Date,
): InspectionSummary => {
  let finished = 0;
  let overdue = 0;
  let found = 0;

  for (const inspection of inspections) {
    const at = inspection.finishedAt;

    if (at && at.getTime() >= period.from.getTime() && at.getTime() <= period.to.getTime()) {
      finished += 1;
      found += inspection.requestIds.length;
    }

    if (isInspectionOverdue(inspection, now)) overdue += 1;
  }

  return { finished, overdue, found };
};

export interface BuildingReport {
  buildingId: string;
  /** Состояние дома сейчас: сколько заявок открыто и сколько просрочено. */
  summary: BuildingSummary;
  /** Работа за период. */
  period: PeriodSummary;
  /** Такой же промежуток перед ним: с ним и сравнивают. */
  previous: PeriodSummary;
  categories: CategoryLoad[];
  assignees: NamedQuality[];
  objects: ProblemObject[];
  incidents: IncidentSummary[];
  inspections: InspectionSummary;
  /** Сколько заявок заводили в каждые сутки периода. */
  daily: number[];
}

/** Сколько суток попадает в отчёт, если период не задан: календарный месяц работы. */
export const DEFAULT_REPORT_DAYS = 30;

/** Сводка по дому для управляющей организации. */
export const buildingReport = async (
  deps: AppDeps,
  resident: Resident,
  days: number = DEFAULT_REPORT_DAYS,
): Promise<BuildingReport> => {
  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'Сводка доступна сотрудникам управляющей организации');
  }

  const buildingId = resident.buildingId ?? deps.defaultBuildingId;
  const now = deps.now();

  const [requests, inspections] = await Promise.all([
    deps.repository.listRequests({ buildingId }),
    deps.repository.listInspections(buildingId),
  ]);

  const period = lastDays(now, days);
  const inPeriod = createdIn(requests, period);

  const quality = assigneeQuality(inPeriod);

  // Имена исполнителей спрашиваются разом: список коротким не бывает только у большого дома.
  const people = await Promise.all(quality.map((item) => deps.repository.findResident(item.assigneeId)));

  const assignees: NamedQuality[] = quality.map((item, index) => ({
    ...item,
    displayName: people[index]?.displayName ?? item.assigneeId,
  }));

  return {
    buildingId,
    summary: summarize(requests, now),
    period: summarizePeriod(requests, period, now),
    previous: summarizePeriod(requests, previousPeriod(period), now),
    categories: categoryLoad(inPeriod, now),
    assignees,
    objects: problemObjects(requests),
    incidents: confirmedIncidents(requests),
    inspections: countInspections(inspections, period, now),
    daily: dailyLoad(inPeriod, period),
  };
};

export interface StaffMember {
  id: string;
  displayName: string;
  role: Resident['role'];
  /** Сколько незакрытых заявок сейчас на человеке. */
  load: number;
}

/** Кому можно поручить работу. */
export const listAssignable = async (deps: AppDeps, resident: Resident): Promise<StaffMember[]> => {
  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'Назначать исполнителя может только управляющая организация');
  }

  const buildingId = resident.buildingId ?? deps.defaultBuildingId;
  const [people, requests] = await Promise.all([
    deps.repository.listResidents(buildingId),
    deps.repository.listRequests({ buildingId }),
  ]);

  const load = assigneeLoad(requests);

  // Наряд делают руками: диспетчер и управляющий в список исполнителей
  // не попадают, иначе они предлагаются сами себе.
  return people
    .filter((person) => person.role === 'technician' || person.role === 'contractor')
    .map((person) => ({
      id: person.id,
      displayName: person.displayName,
      role: person.role,
      load: load.get(person.id) ?? 0,
    }))
    .sort((left, right) => left.load - right.load || left.displayName.localeCompare(right.displayName));
};

const REGISTRY_COLUMNS = [
  'Номер',
  'Категория',
  'Объект',
  'Статус',
  'Подана',
  'Срок выполнения',
  'Сдана',
  'В срок',
  'Исполнитель',
  'Сообщили',
  'Возвратов',
  'Оценка',
  'Описание',
];

const moment = (at: Date | undefined, timeZone: string = DEFAULT_TIME_ZONE): string =>
  at === undefined ? '' : at.toLocaleString('ru-RU', { timeZone });

/** Реестр заявок за период: строки без разметки, обёртку выбирает адаптер. */
export const requestsTable = async (
  deps: AppDeps,
  resident: Resident,
  range: number | ExportPeriod = DEFAULT_REPORT_DAYS,
): Promise<Table> => {
  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'Выгрузка доступна сотрудникам управляющей организации');
  }

  const buildingId = resident.buildingId ?? deps.defaultBuildingId;
  const now = deps.now();
  const period = typeof range === 'number' ? lastDays(now, range) : range;
  // Реестр за месяц не читает историю дома за все годы: нижняя граница совпадает с `createdIn`.
  const [zone, found] = await Promise.all([
    zoneOf(deps, buildingId),
    deps.repository.listRequests({ buildingId, createdAfter: period.from }),
  ]);

  const requests = createdIn(found, period);

  const assigneeIds = [...new Set(requests.flatMap((request) => (request.assigneeId ? [request.assigneeId] : [])))];
  const people = await Promise.all(assigneeIds.map((id) => deps.repository.findResident(id)));

  const names = new Map<string, string>(
    assigneeIds.map((id, index) => [id, people[index]?.displayName ?? id]),
  );

  const rows: (string | number)[][] = [...requests]
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .map((request) => [
      request.number,
      CATEGORY_RULES[request.category].title,
      describeTarget(request.target),
      STATUS_TITLES[request.status],
      moment(request.createdAt, zone),
      moment(request.resolutionDueAt, zone),
      moment(settledAt(request), zone),
      missedDeadline(request, now) ? 'нет' : 'да',
      request.assigneeId ? (names.get(request.assigneeId) ?? '') : '',
      reportersCount(request),
      request.reopenCount,
      request.rating ?? '',
      request.description,
    ]);

  const from = period.from.toISOString().slice(0, 10);
  const to = period.to.toISOString().slice(0, 10);

  return {
    name: `заявки-${buildingId}-${from}_${to}`,
    columns: [...REGISTRY_COLUMNS],
    rows,
  };
};

/** Тот же реестр текстом с разделителями. */
export const exportRequests = async (
  deps: AppDeps,
  resident: Resident,
  range: number | ExportPeriod = DEFAULT_REPORT_DAYS,
): Promise<{ filename: string; csv: string }> => {
  const table = await requestsTable(deps, resident, range);

  return { filename: `${table.name}.csv`, csv: csvFrom(table) };
};

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** Сводка текстом для чата. */
/**
 * Сводка для чата: три строки вместо полного разбора. Разрезы по категориям,
 * исполнителям и объектам читаются в приложении, там для них есть место.
 */
export const formatReportShort = (report: BuildingReport): string => {
  const { summary, period, previous } = report;
  const days = Math.round((period.to.getTime() - period.from.getTime()) / (24 * 3_600_000));
  const inTime = period.closed > 0 ? `, в срок ${percent(period.inTimeRate)}` : '';

  return [
    `Сейчас: открыто ${summary.open}, просрочено ${summary.overdue}`,
    `За ${days} дн.: подано ${period.created} (было ${previous.created}), закрыто ${period.closed}${inTime}`,
    // Склейка обращений: показывает, сколько звонков заменила одна заявка.
    period.mergedReports > 0
      ? `Обращений присоединено к существующим заявкам: ${period.mergedReports}`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n');
};

export const formatReport = (report: BuildingReport): string => {
  const { summary, period, previous } = report;
  const days = Math.round((period.to.getTime() - period.from.getTime()) / (24 * 3_600_000));

  const lines = [
    `Сейчас: открыто ${summary.open}, из них просрочено ${summary.overdue}.`,
    '',
    `За ${days} дн.: подано ${period.created} (было ${previous.created}), закрыто ${period.closed}.`,
  ];

  if (period.closed > 0) {
    const before = previous.closed > 0 ? ` (было ${percent(previous.inTimeRate)})` : '';

    lines.push(`В срок: ${percent(period.inTimeRate)}${before}.`);
    lines.push(`Среднее время до сдачи работ: ${period.averageHours} ч.`);
  }

  if (period.mergedReports > 0) {
    lines.push(`Обращений присоединено к существующим заявкам: ${period.mergedReports}.`);
  }

  if (report.incidents.length > 0) {
    lines.push('', 'Аварии с несколькими обращениями:');

    for (const incident of report.incidents) {
      lines.push(`  ${incident.number}: ${incident.title}, сообщили ${incident.reporters}`);
    }
  }

  const failing = report.categories.filter((category) => category.overdue > 0);

  if (failing.length > 0) {
    lines.push('', 'Где не укладываемся:');

    for (const category of failing) {
      lines.push(`  ${category.title}: ${category.overdue} из ${category.total} (${percent(category.overdueRate)})`);
    }
  }

  const returned = report.assignees.filter((assignee) => assignee.reopened > 0);

  if (returned.length > 0) {
    lines.push('', 'Работы, которые жильцы не приняли:');

    for (const assignee of returned) {
      lines.push(
        `  ${assignee.displayName}: ${assignee.reopened} из ${assignee.completed} (${percent(assignee.reopenRate)})`,
      );
    }
  }

  if (report.objects.length > 0) {
    lines.push('', 'Ломается чаще прочего:');

    for (const object of report.objects) {
      lines.push(`  ${object.title}: обращений ${object.requests}`);
    }
  }

  return lines.join('\n');
};
