import {
  DomainError,
  INSPECTION_RULES,
  isCompanyStaff,
  checkItem as applyCheck,
  encodeTarget,
  planInspection,
  provesPresence,
  type Attachment,
  type Inspection,
  type InspectionKind,
  type ItemState,
  type RequestTarget,
} from '@domovoy/domain';

import { recordAction } from './audit.js';
import { servedBy } from './buildings.js';
import { submitProblem } from './incidents.js';
import { formatInspection, noopNotifier, notifyAbout } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Отметка пункта словами журнала. */
const ITEM_STATE_TITLES: Record<ItemState, string> = { ok: 'в порядке', problem: 'недостаток' };

/** Сколько подъездов обходить, если дом заведён без квартир. */
const guessEntrances = async (deps: AppDeps, buildingId: string): Promise<number[]> => {
  const apartments = await deps.repository.listApartments(buildingId);
  const entrances = [...new Set(apartments.map((apartment) => apartment.entrance))].sort((a, b) => a - b);

  return entrances.length > 0 ? entrances : [1];
};

/** Кому достанется обход. */
const assigneeFor = (staff: readonly Resident[], planned: readonly Inspection[]): string | undefined => {
  const technicians = staff.filter((person) => person.role === 'technician');

  if (technicians.length === 0) return undefined;

  const load = new Map(technicians.map((person) => [person.id, 0]));

  for (const inspection of planned) {
    if (inspection.finishedAt || !inspection.assigneeId) continue;

    load.set(inspection.assigneeId, (load.get(inspection.assigneeId) ?? 0) + 1);
  }

  return [...load.entries()].sort((left, right) => left[1] - right[1])[0]?.[0];
};

/** Заводит обходы, которым подошёл срок. */
export const planInspections = async (deps: AppDeps, buildingId: string): Promise<Inspection[]> => {
  const now = deps.now();
  const existing = await deps.repository.listInspections(buildingId);
  const staff = await deps.repository.listStaff(buildingId);
  const notifier = deps.notifier ?? noopNotifier;
  const planned: Inspection[] = [];

  const equipment = await deps.repository.listEquipment(buildingId);

  for (const kind of Object.keys(INSPECTION_RULES) as InspectionKind[]) {
    const rule = INSPECTION_RULES[kind];
    const units = rule.byEquipment
      ? equipment.filter((item) => item.kind === rule.byEquipment).map((item) => item.code)
      : [undefined];
    const places = rule.byEntrance ? await guessEntrances(deps, buildingId) : [undefined];

    for (const equipmentCode of units) {
      for (const entrance of places) {
        const own = existing.filter(
          (item) => item.kind === kind && item.entrance === entrance && item.equipmentCode === equipmentCode,
        );
        const unfinished = own.some((item) => !item.finishedAt);

        if (unfinished) continue;

        const last = own
          .map((item) => item.finishedAt)
          .filter((at): at is Date => at !== undefined)
          .sort((left, right) => right.getTime() - left.getTime())[0];

        if (last && now.getTime() - last.getTime() < rule.everyDays * DAY_MS) continue;

        const assigneeId = assigneeFor(staff, [...existing, ...planned]);

        const created = await deps.repository.saveInspection(
          planInspection({
            id: deps.createId(),
            buildingId,
            kind,
            ...(entrance === undefined ? {} : { entrance }),
            ...(equipmentCode ? { equipmentCode } : {}),
            createdAt: now,
            ...(assigneeId ? { assigneeId } : {}),
          }),
        );

        planned.push(created);

        await notifyAbout(
          notifier,
          staff.find((person) => person.id === assigneeId),
          formatInspection(created),
          { section: 'inspections' },
        );
      }
    }
  }

  return planned;
};

/** @throws {DomainError} */
const forStaff = (resident: Resident): void => {
  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'Осмотры общего имущества ведёт управляющая организация');
  }
};

/** Обходы дома: сначала незаконченные, среди них с ближайшим сроком. */
export const listInspections = async (deps: AppDeps, resident: Resident): Promise<Inspection[]> => {
  forStaff(resident);

  const buildingId = resident.buildingId ?? deps.defaultBuildingId;
  const found = await deps.repository.listInspections(buildingId);

  return found.sort((left, right) => {
    if (Boolean(left.finishedAt) !== Boolean(right.finishedAt)) return left.finishedAt ? 1 : -1;

    return left.dueAt.getTime() - right.dueAt.getTime();
  });
};

/** Что именно осматривают: по этой наклейке мастер и подтверждает выезд. */
const addressOf = (inspection: Inspection): RequestTarget =>
  inspection.equipmentCode
    ? { kind: 'equipment', buildingId: inspection.buildingId, equipmentId: inspection.equipmentCode }
    : inspection.entrance === undefined
      ? { kind: 'building', buildingId: inspection.buildingId }
      : { kind: 'entrance', buildingId: inspection.buildingId, entrance: inspection.entrance };

export interface ProveCommand {
  resident: Resident;
  inspectionId: string;
  /** Код с наклейки объекта. */
  code: string;
}

/** Отметка о выезде на обход. @throws {DomainError} */
export const proveInspection = async (deps: AppDeps, command: ProveCommand): Promise<Inspection> => {
  forStaff(command.resident);

  const found = await deps.repository.findInspection(command.inspectionId);

  if (!found) throw new DomainError('inspection_not_found', 'Осмотр не найден');

  if (!servedBy(command.resident, deps).includes(found.buildingId)) {
    throw new DomainError('forbidden', 'Это осмотр другого дома');
  }

  if (!provesPresence(addressOf(found), command.code)) {
    throw new DomainError('wrong_object', 'Это наклейка другого объекта');
  }

  return deps.repository.saveInspection({ ...found, onSite: true });
};

export interface CheckCommand {
  resident: Resident;
  inspectionId: string;
  index: number;
  state: ItemState;
  comment?: string;
  attachments?: Attachment[];
}

/** Отметка пункта осмотра. @throws {DomainError} */
export const checkInspectionItem = async (
  deps: AppDeps,
  command: CheckCommand,
): Promise<{ inspection: Inspection; requestId?: string }> => {
  forStaff(command.resident);

  const found = await deps.repository.findInspection(command.inspectionId);

  if (!found) throw new DomainError('inspection_not_found', 'Осмотр не найден');

  if (!servedBy(command.resident, deps).includes(found.buildingId)) {
    throw new DomainError('forbidden', 'Это осмотр другого дома');
  }

  const updated = applyCheck({
    inspection: found,
    index: command.index,
    state: command.state,
    at: deps.now(),
    ...(command.comment === undefined ? {} : { comment: command.comment }),
    ...(command.attachments === undefined ? {} : { attachments: command.attachments }),
  });

  const checked = updated.items[command.index];

  await recordAction(deps, {
    actor: command.resident,
    action: 'inspection_checked',
    subject: INSPECTION_RULES[updated.kind].title,
    buildingId: updated.buildingId,
    details: [checked?.title, ITEM_STATE_TITLES[command.state], command.comment?.trim()].filter(Boolean).join(': '),
  });

  if (command.state === 'ok') {
    return { inspection: await deps.repository.saveInspection(updated) };
  }

  const item = updated.items[command.index]!;
  const address =
    updated.entrance === undefined
      ? { kind: 'building' as const, buildingId: updated.buildingId }
      : { kind: 'entrance' as const, buildingId: updated.buildingId, entrance: updated.entrance };

  const result = await submitProblem(deps, {
    resident: command.resident,
    title: item.title,
    description: `${INSPECTION_RULES[updated.kind].title}: ${item.comment ?? item.title}`,
    startParam: encodeTarget(address),
    ...(command.attachments?.length ? { attachments: command.attachments } : {}),
    anyway: true,
  });

  const requestId = result.kind === 'created' || result.kind === 'joined' ? result.request.id : undefined;

  const saved = await deps.repository.saveInspection(
    requestId ? { ...updated, requestIds: [...updated.requestIds, requestId] } : updated,
  );

  return { inspection: saved, ...(requestId ? { requestId } : {}) };
};
