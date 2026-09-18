import {
  OPEN_STATUSES,
  WORKING_HOURS,
  isInspectionOverdue,
  isOverdue,
  onCall,
  type Inspection,
  type ServiceRequest,
} from '@domovoy/domain';

import { dueSoon, equipmentHealthOf } from './health.js';
import { noopNotifier, notifyResident } from './notifier.js';
import { zoneOf } from './zone.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

export interface DigestCounts {
  /** Заведено за сутки. */
  created: number;
  /** Из них аварийных. */
  emergency: number;
  /** Открыто сейчас. */
  open: number;
  /** Из открытых те, у которых нарушен срок. */
  overdue: number;
  /** Ждут приёмки жильцом: работа сделана, но не закрыта. */
  waiting: number;
  /** Ждут ответа жильца: срок по ним не идёт, но и работа стоит. */
  needsInfo: number;
  /** Осмотры общего имущества с вышедшим сроком. */
  inspections: number;
  /** Что вот-вот встанет по своей же истории поломок. */
  soon?: readonly string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const countForDigest = (
  requests: readonly ServiceRequest[],
  now: Date,
  inspections: readonly Inspection[] = [],
): DigestCounts => {
  const since = new Date(now.getTime() - DAY_MS);
  let created = 0;
  let emergency = 0;
  let open = 0;
  let overdue = 0;
  let waiting = 0;
  let needsInfo = 0;

  for (const request of requests) {
    if (request.createdAt.getTime() > since.getTime()) {
      created += 1;
      if (request.priority === 'emergency') emergency += 1;
    }

    if (!OPEN_STATUSES.includes(request.status)) continue;

    open += 1;
    if (isOverdue(request, now)) overdue += 1;
    if (request.status === 'done') waiting += 1;
    if (request.status === 'needs_info') needsInfo += 1;
  }

  return {
    created,
    emergency,
    open,
    overdue,
    waiting,
    needsInfo,
    inspections: inspections.filter((inspection) => isInspectionOverdue(inspection, now)).length,
  };
};

/** Сводка одной строкой. */
export const formatDigest = (counts: DigestCounts): string | undefined => {
  const soon = counts.soon ?? [];

  if (counts.open === 0 && counts.created === 0 && counts.inspections === 0 && soon.length === 0) return undefined;

  const lines = [
    `За сутки: ${counts.created}${counts.emergency > 0 ? `, из них аварийных ${counts.emergency}` : ''}`,
    `Открыто: ${counts.open}${counts.overdue > 0 ? `, просрочено ${counts.overdue}` : ''}`,
  ];

  if (counts.waiting > 0) lines.push(`Ждут приёмки: ${counts.waiting}`);
  if (counts.needsInfo > 0) lines.push(`Ждут ответа жильца: ${counts.needsInfo}`);
  if (counts.inspections > 0) lines.push(`Просрочено осмотров: ${counts.inspections}`);
  if (soon.length > 0) lines.push(`Пора смотреть: ${soon.join(', ')}`);

  return `Доброе утро. ${lines.join('\n')}`;
};

/** Названия оборудования, которое скоро сломается. */
const wearing = async (deps: AppDeps, buildingId: string): Promise<string[]> =>
  dueSoon(await equipmentHealthOf(deps, buildingId)).map((item) => item.title);

/** Сводка по дому и смена, которой она уходит. Пусто, когда говорить не о чем. */
const digestFor = async (
  deps: AppDeps,
  buildingId: string,
  now: Date,
): Promise<{ text: string; staff: Resident[] } | undefined> => {
  const requests = await deps.repository.listRequests({ buildingId });
  const inspections = await deps.repository.listInspections(buildingId);
  const text = formatDigest({ ...countForDigest(requests, now, inspections), soon: await wearing(deps, buildingId) });

  if (!text) return undefined;

  const staff = onCall(
    await deps.repository.listStaff(buildingId),
    now,
    WORKING_HOURS,
    await zoneOf(deps, buildingId),
  );

  return { text, staff };
};

/** Утренняя сводка смене. */
export const sendMorningDigest = async (deps: AppDeps, buildingId: string): Promise<Resident[]> => {
  const digest = await digestFor(deps, buildingId, deps.now());

  if (!digest) return [];

  const notifier = deps.notifier ?? noopNotifier;

  for (const person of digest.staff) await notifyResident(notifier, person, digest.text);

  return digest.staff;
};

/** Утренняя сводка по всем домам компании. */
export const sendMorningDigests = async (deps: AppDeps): Promise<number> => {
  const now = deps.now();
  const byPerson = new Map<string, { person: Resident; lines: string[] }>();
  const buildings = await deps.repository.listBuildings();

  for (const building of buildings) {
    const digest = await digestFor(deps, building.id, now);

    if (!digest) continue;

    for (const person of digest.staff) {
      const own = byPerson.get(person.id) ?? { person, lines: [] };

      own.lines.push(buildings.length > 1 ? `${building.code}\n${withoutGreeting(digest.text)}` : digest.text);
      byPerson.set(person.id, own);
    }
  }

  const notifier = deps.notifier ?? noopNotifier;

  for (const { person, lines } of byPerson.values()) {
    const text = lines.length === 1 ? lines[0]! : `Доброе утро.\n\n${lines.join('\n\n')}`;

    await notifyResident(notifier, person, text);
  }

  return byPerson.size;
};

const withoutGreeting = (text: string): string => text.replace(/^Доброе утро\.\s*/, '');
