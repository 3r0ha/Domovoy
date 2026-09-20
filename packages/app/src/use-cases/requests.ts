import {
  addMessage,
  applyTransition,
  audienceForTarget,
  CLOSED_STATUSES,
  compareByUrgency,
  decodeTarget,
  DomainError,
  elderNow,
  hasReported,
  isFinal,
  isSharedInfrastructure,
  OPEN_STATUSES,
  plural,
  provesPresence,
  reporterIds,
  selectAudience,
  statusTitle,
  suggestCategory,
  suggestPriority,
  type Apartment,
  type Attachment,
  type Priority,
  type RequestCategory,
  type RequestStatus,
  type RequestTarget,
  type ServiceRequest,
} from '@domovoy/domain';

import { locateTarget } from '../apartments.js';
import { recordAction } from '../audit.js';
import { announceResolved } from '../broadcast.js';
import { assertApartment } from '../buildings.js';
import {
  actionsFor,
  formatAssignment,
  formatMessage,
  formatNeighbourAlert,
  formatNeighbourQuestion,
  formatStatusChange,
  noopNotifier,
  notifyResident,
} from '../notifier.js';
import { type Resident } from '../repository.js';
import { houseZone } from '../zone.js';
import { assertMayTargetApartment, assertStaffServes, canActNow, canView, entranceOf } from './access.js';
import { type AppDeps, type RequestPage } from './deps.js';

export interface CreateRequestCommand {
  resident: Resident;
  description: string;
  /** Короткая суть. Если не задана, делается из описания. */
  title?: string;
  category?: RequestCategory;
  /** Срочность, если её знает не текст: датчик протечки это всегда авария. */
  priority?: Priority;
  /** Код объекта с наклейки. */
  startParam?: string;
  apartmentId?: string;
  /** Квартира не называется: обращение о доме, а не о квартире автора. */
  house?: boolean;
  attachments?: Attachment[];
  /** Завести отдельную заявку, что бы продукт ни думал о совпадении. */
  anyway?: boolean;
  /** Заявка, к которой обращение только что присоединили: участие в ней снимается. */
  apartFrom?: string;
}

/** Дополняет адрес тем, что читает человек: номером квартиры или названием оборудования. */
export const withReadableAddress = async (
  deps: AppDeps,
  target: RequestTarget,
  known?: Apartment,
): Promise<RequestTarget> => {
  if (target.kind === 'apartment') {
    const apartment = known ?? (await deps.repository.findApartment(target.apartmentId));

    return apartment ? { ...target, number: apartment.number } : target;
  }

  if (target.kind === 'equipment') {
    const equipment = await deps.repository.findEquipment(target.buildingId, target.equipmentId);

    return equipment ? { ...target, title: equipment.title } : target;
  }

  return target;
};

/**
 * Куда указывает обращение: код с наклейки, названная квартира, дом целиком
 * или привязка автора. Привязка идёт последней: она подставляется только тогда,
 * когда адрес не назвали, а «квартира не указана» её и отменяет.
 */
export const targetOf = (command: CreateRequestCommand): RequestTarget | null =>
  command.startParam
    ? decodeTarget(command.startParam)
    : command.apartmentId
      ? { kind: 'apartment', apartmentId: command.apartmentId }
      : command.house && command.resident.buildingId
        ? { kind: 'building', buildingId: command.resident.buildingId }
        : command.resident.apartmentId
          ? { kind: 'apartment', apartmentId: command.resident.apartmentId }
          : // Сотрудник без квартиры: обращение уходит на дом смены. Жильцу без
            // квартиры дом не подставляется.
            command.resident.buildingId && command.resident.role !== 'resident'
            ? { kind: 'building', buildingId: command.resident.buildingId }
            : null;

export const createServiceRequest = async (deps: AppDeps, command: CreateRequestCommand): Promise<ServiceRequest> => {
  const { resident, description } = command;

  await assertMayTargetApartment(deps, command);

  const target: RequestTarget | null = targetOf(command);

  if (!target) {
    assertApartment(resident);

    throw new DomainError('target_required', 'Не удалось определить адрес заявки');
  }

  const apartment = target.kind === 'apartment' ? await deps.repository.findApartment(target.apartmentId) : undefined;
  const buildingId = target.kind === 'apartment' ? (apartment?.buildingId ?? resident.buildingId) : target.buildingId;

  if (!buildingId) {
    throw new DomainError('building_unknown', 'Не удалось определить дом');
  }

  const located = await withReadableAddress(deps, target, apartment);

  const category = command.category ?? suggestCategory(description);
  const priority = command.priority ?? suggestPriority(description, category);

  const createdAt = deps.now();
  const code = (await deps.repository.buildingCode(buildingId)) ?? 'Д';
  const sequence = await deps.repository.nextRequestSequence(buildingId, createdAt);

  const created = await deps.repository.createRequest({
    id: deps.createId(),
    buildingId,
    buildingCode: code,
    sequence,
    authorId: resident.id,
    category,
    priority,
    target: located,
    description,
    ...(command.title?.trim() ? { title: command.title.trim() } : {}),
    createdAt,
    ...(command.attachments?.length ? { attachments: command.attachments } : {}),
  });

  // Заявку по звонку, с осмотра или от датчика заводит смена: в журнале дома
  // видно, кто её завёл. Заявки жильцов сюда не попадают.
  await recordAction(deps, {
    actor: resident,
    action: 'request_created',
    subject: created.number,
    buildingId: created.buildingId,
    details: created.title,
  });

  return created;
};

export interface TransitionCommand {
  resident: Resident;
  requestId: string;
  to: RequestStatus;
  comment?: string;
  assigneeId?: string;
  /** Снимок результата: мастер показывает, что именно сделано. */
  attachments?: Attachment[];
  /** Оценка работы жильцом, 1…5. Только вместе с приёмкой. */
  rating?: number;
  /** Код с наклейки объекта: им мастер подтверждает, что был на месте. */
  provedBy?: string;
  /**
   * Промежуточный шаг, о котором никого не извещают: заявку принимают только
   * затем, чтобы тут же поручить, и жильцу нужно одно сообщение, а не два.
   */
  quiet?: boolean;
}

export const transitionRequest = async (deps: AppDeps, command: TransitionCommand): Promise<ServiceRequest> => {
  const found = await deps.repository.findRequest(command.requestId);
  if (!found) throw new DomainError('request_not_found', 'Заявка не найдена');

  if (!(await canActNow(deps, command.resident, found))) {
    throw new DomainError('request_not_found', 'Заявка не найдена');
  }

  await assertStaffServes(deps, command.resident, found);

  if (command.provedBy && !provesPresence(found.target, command.provedBy)) {
    throw new DomainError('wrong_object', 'Это наклейка другого объекта');
  }

  if (command.to === 'withdrawn' && found.authorId !== command.resident.id) {
    throw new DomainError('forbidden', 'Снять заявку может только тот, кто её подал');
  }

  const updated = applyTransition(found, {
    to: command.to,
    role: command.resident.role,
    actorId: command.resident.id,
    at: deps.now(),
    ...(command.comment ? { comment: command.comment } : {}),
    ...(command.assigneeId ? { assigneeId: command.assigneeId } : {}),
    ...(command.attachments?.length ? { attachments: command.attachments } : {}),
    ...(command.rating === undefined ? {} : { rating: command.rating }),
    ...(command.provedBy ? { onSite: true } : {}),
  });

  const saved = await deps.repository.saveRequest(updated);

  const assignment = await assignmentOf(deps, command, found, saved);

  await auditTransition(deps, command, found, saved, assignment);

  await tellAboutTransition(deps, command, found, saved, assignment);

  if (found.status === 'new' && saved.status === 'accepted') {
    await askNeighbours(deps, saved);
  }

  if (!isFinal(found.status) && isFinal(saved.status)) {
    await announceResolved(deps, saved);
  }

  return saved;
};

/** Исполнитель, назначенный этим переходом. */
interface Assignment {
  id: string;
  /** Профиль исполнителя, если он в доме известен. */
  person?: Resident;
}

/** Кого назначили переходом. Читается один раз: имя нужно и журналу, и уведомлению. */
const assignmentOf = async (
  deps: AppDeps,
  command: TransitionCommand,
  before: ServiceRequest,
  saved: ServiceRequest,
): Promise<Assignment | undefined> => {
  const id = saved.assigneeId;

  if (!id || id === before.assigneeId) return undefined;
  if (id === command.resident.id) return { id, person: command.resident };

  const person = await deps.repository.findResident(id);

  return { id, ...(person ? { person } : {}) };
};

/**
 * Работа по заявке в журнале дома: смена состояния и назначение исполнителя.
 * Действия жильца журнал пропускает сам.
 */
const auditTransition = async (
  deps: AppDeps,
  command: TransitionCommand,
  before: ServiceRequest,
  saved: ServiceRequest,
  assignment: Assignment | undefined,
): Promise<void> => {
  const comment = command.comment?.trim();

  if (saved.status !== before.status) {
    const details =
      saved.status === 'rejected'
        ? comment
        : [statusTitle(saved.status, true), comment].filter(Boolean).join(': ');

    await recordAction(deps, {
      actor: command.resident,
      action: saved.status === 'rejected' ? 'request_rejected' : 'request_status',
      subject: saved.number,
      buildingId: saved.buildingId,
      ...(details ? { details } : {}),
    });
  }

  if (!assignment) return;

  await recordAction(deps, {
    actor: command.resident,
    action: 'request_assigned',
    subject: saved.number,
    buildingId: saved.buildingId,
    details: assignment.person?.displayName ?? assignment.id,
  });
};

/** Кому уходит смена статуса: заявителям, старшему по подъезду и новому исполнителю. */
const tellAboutTransition = async (
  deps: AppDeps,
  command: TransitionCommand,
  before: ServiceRequest,
  saved: ServiceRequest,
  assignment: Assignment | undefined,
): Promise<void> => {
  if (command.quiet) return;

  const text = formatStatusChange(saved);
  const notifier = deps.notifier ?? noopNotifier;
  const entrance = entranceOf(saved.target);
  const elder =
    entrance === undefined
      ? undefined
      : elderNow(await deps.repository.listElderships(saved.buildingId), entrance, deps.now());

  for (const id of new Set([...reporterIds(saved), ...(elder ? [elder.residentId] : [])])) {
    if (id === command.resident.id) continue;

    const person = await deps.repository.findResident(id);

    await notifyResident(
      notifier,
      person,
      text,
      person ? actionsFor(saved, person) : [],
      OPEN_STATUSES.includes(saved.status) ? saved.id : undefined,
    );
  }

  // Исполнитель, которого не меняли, о смене состояния тоже узнаёт: работу
  // ему вернули или у него спросили, а он об этом молчит и ждёт.
  if (!assignment && saved.assigneeId && saved.assigneeId !== command.resident.id) {
    const worker = await deps.repository.findResident(saved.assigneeId);

    await notifyResident(
      notifier,
      worker,
      text,
      worker ? actionsFor(saved, worker) : [],
      OPEN_STATUSES.includes(saved.status) ? saved.id : undefined,
    );
  }

  if (!assignment || assignment.id === command.resident.id) return;

  const assignee = assignment.person;

  await notifyResident(
    notifier,
    assignee,
    formatAssignment(saved, await houseZone(deps, saved.buildingId)),
    assignee ? actionsFor(saved, assignee) : [],
    saved.id,
  );

  if (before.assigneeId && before.assigneeId !== command.resident.id) {
    await notifyResident(
      notifier,
      await deps.repository.findResident(before.assigneeId),
      `Заявка ${saved.number} передана другому исполнителю.`,
    );
  }
};

export interface CommentCommand {
  resident: Resident;
  requestId: string;
  text: string;
  attachments?: Attachment[];
}

/** Сообщение по заявке от жильца или сотрудника. @throws {DomainError} */
export const commentRequest = async (deps: AppDeps, command: CommentCommand): Promise<ServiceRequest> => {
  const found = await deps.repository.findRequest(command.requestId);
  if (!found) throw new DomainError('request_not_found', 'Заявка не найдена');

  if (!(await canActNow(deps, command.resident, found))) {
    throw new DomainError('request_not_found', 'Заявка не найдена');
  }

  await assertStaffServes(deps, command.resident, found);

  const saved = await deps.repository.saveRequest(
    addMessage(found, {
      role: command.resident.role,
      actorId: command.resident.id,
      at: deps.now(),
      text: command.text,
      ...(command.attachments?.length ? { attachments: command.attachments } : {}),
    }),
  );

  await notifyAboutMessage(deps, saved, command);

  return saved;
};

/** Кому уходит сообщение по заявке. */
const notifyAboutMessage = async (deps: AppDeps, request: ServiceRequest, command: CommentCommand): Promise<void> => {
  const notifier = deps.notifier ?? noopNotifier;
  const reporters = reporterIds(request);
  const files = command.attachments?.length ?? 0;

  // Снимок без подписи уходил пустой строкой: получатель видел «пишет:» и ничего.
  const text =
    command.text.trim() ||
    (files > 0 ? `прислал ${plural(files, 'вложение', 'вложения', 'вложений')}` : '');

  const send = async (ids: readonly string[], author: string): Promise<void> => {
    for (const id of new Set(ids)) {
      if (id === command.resident.id) continue;

      const to = await deps.repository.findResident(id);

      await notifyResident(notifier, to, formatMessage(request, author, text), [], request.id);
    }
  };

  if (command.resident.role !== 'resident' && !hasReported(request, command.resident.id)) {
    await send(reporters, 'Управляющая компания');
    return;
  }

  // Ответ жильца получает исполнитель и тот из смены, кто уже писал по заявке:
  // диспетчер спрашивает про доступ в квартиру и должен увидеть ответ сам.
  const talked = request.history
    .filter((event) => event.kind === 'message' && event.role !== 'resident')
    .map((event) => event.actorId);

  const staff = [...(request.assigneeId ? [request.assigneeId] : []), ...talked];

  await send(
    staff.length > 0 ? staff : (await deps.repository.listStaff(request.buildingId)).map((person) => person.id),
    'Жилец',
  );

  if (reporters.length > 1) await send(reporters, 'Сосед');
};

/** Кого спросить и о чём предупредить, когда аварию приняли в работу. */
const askNeighbours = async (deps: AppDeps, request: ServiceRequest): Promise<void> => {
  const shared = audienceForTarget(request.target);
  const audience =
    shared ?? (isSharedInfrastructure(request.category) ? await locateTarget(deps, request.target) : null);

  if (!audience) return;

  const apartments = await deps.repository.listApartments(audience.buildingId);
  const affected = selectAudience(apartments, audience).map((apartment) => apartment.id);
  const residents = await deps.repository.listResidentsByApartments(affected);
  const known = new Set(reporterIds(request));
  const text = shared ? formatNeighbourAlert(request, request.resolutionDueAt) : formatNeighbourQuestion(request);

  for (const resident of residents) {
    if (known.has(resident.id)) continue;

    await notifyResident(deps.notifier ?? noopNotifier, resident, text, [], { askAbout: request.id });
  }
};

export const getRequestFor = async (
  deps: AppDeps,
  resident: Resident,
  requestId: string,
): Promise<ServiceRequest | undefined> => {
  const found = await deps.repository.findRequest(requestId);
  if (!found) return undefined;

  if (!canView(resident, found)) throw new DomainError('forbidden', 'Эта заявка не ваша');

  await assertStaffServes(deps, resident, found);

  return found;
};

export type RequestScope = 'mine' | 'queue' | 'closed';

/** Закрытых заявок за годы накапливается больше, чем открытых. */
export const CLOSED_PAGE = 20;

/** Список заявок: жилец видит свои, сотрудник очередь дома, срочное сверху. */
export const listRequestsFor = async (
  deps: AppDeps,
  resident: Resident,
  scope: RequestScope,
  page?: RequestPage,
): Promise<ServiceRequest[]> => {
  const isStaff = resident.role !== 'resident';
  const moment = deps.now();

  if (scope === 'queue' && isStaff && resident.role !== 'contractor') {
    const queue = await deps.repository.listRequests({
      buildingId: resident.buildingId ?? deps.defaultBuildingId,
      statuses: [...OPEN_STATUSES],
    });

    return [...queue].sort((left, right) => compareByUrgency(left, right, moment));
  }

  const closed = scope === 'closed';
  const window = closed
    ? {
        statuses: [...CLOSED_STATUSES],
        limit: page?.limit ?? CLOSED_PAGE,
        ...(page?.before ? { createdBefore: page.before } : {}),
      }
    : { statuses: [...OPEN_STATUSES] };

  const reported = await deps.repository.listRequests({ reporterId: resident.id, ...window });
  const assigned = isStaff ? await deps.repository.listRequests({ assigneeId: resident.id, ...window }) : [];
  const unique = new Map(([] as ServiceRequest[]).concat(reported, assigned).map((request) => [request.id, request]));
  const found = [...unique.values()];

  if (!closed) return found.sort((left, right) => compareByUrgency(left, right, moment));

  return found
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, page?.limit ?? CLOSED_PAGE);
};
