import {
  DomainError,
  MISSED_VISIT_LIMIT,
  OPEN_STATUSES,
  accessRefused,
  applyTransition,
  dropVisitSlot,
  formatClock,
  formatMoment,
  isCompanyStaff,
  missVisit,
  missedVisits,
  needsAccess,
  offerVisit,
  pickVisit,
  visitWindows,
  type ServiceRequest,
} from '@domovoy/domain';

import { daysApart, type Translate } from '@domovoy/i18n';

import { recordAction } from './audit.js';
import { pickTimeByWords } from './reasoner.js';
import { speak, speakDefault } from './language.js';
import { describePlace, noopNotifier, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { canView } from './use-cases/access.js';
import { zoneOf } from './zone.js';

/**
 * Согласование визита в квартиру. Работы в квартире требуют, чтобы дома
 * кто-то был: продукт предлагает жильцу окна, как только заявка ушла в работу,
 * а неудачный выезд записывает и двигает срок.
 */

/** Заявка, к которой у человека есть доступ. @throws {DomainError} */
const requestFor = async (deps: AppDeps, resident: Resident, requestId: string): Promise<ServiceRequest> => {
  const found = await deps.repository.findRequest(requestId);

  if (!found || !canView(resident, found)) {
    throw new DomainError('request_not_found', 'Заявка не найдена');
  }

  return found;
};

/** Автор заявки: ему и выбирать время. */
const authorOf = async (deps: AppDeps, request: ServiceRequest): Promise<Resident | undefined> =>
  deps.repository.findResident(request.authorId);

/** Окна визита на ближайшие дни по времени дома. */
export const slotsForHouse = async (deps: AppDeps, request: ServiceRequest): Promise<Date[]> =>
  visitWindows(deps.now(), await zoneOf(deps, request.buildingId));

/**
 * Предложить жильцу время. Вызывается и сценарием, когда заявка уходит в работу,
 * и смены руками, когда время нужно согласовать заново. @throws {DomainError}
 */
export const proposeVisit = async (
  deps: AppDeps,
  staff: Resident,
  requestId: string,
): Promise<ServiceRequest> => {
  const found = await requestFor(deps, staff, requestId);

  if (!isCompanyStaff(staff.role)) {
    throw new DomainError('forbidden', 'Время визита предлагает управляющая организация');
  }

  const saved = await deps.repository.saveRequest(
    offerVisit(found, { slots: await slotsForHouse(deps, found), actorId: staff.id, at: deps.now() }),
  );

  await tellAboutOffer(deps, saved);

  return saved;
};

/** Уведомление жильцу с окнами на выбор. */
const tellAboutOffer = async (deps: AppDeps, request: ServiceRequest): Promise<void> => {
  const author = await authorOf(deps, request);
  const slots = request.appointment?.slots ?? [];

  if (!author || slots.length === 0) return;

  const t = speak(author);

  await notifyResident(deps.notifier ?? noopNotifier, author, t('app.visit.offer', { номер: request.number }), [], {
    visitAbout: { requestId: request.id, slots: slots.map((slot) => slot.toISOString()) },
  });
};

export interface PickVisitCommand {
  resident: Resident;
  requestId: string;
  at: Date;
}

/** Жилец выбрал время. Мастер узнаёт о нём, а заявка помнит. @throws {DomainError} */
export const takeVisitSlot = async (deps: AppDeps, command: PickVisitCommand): Promise<ServiceRequest> => {
  const found = await requestFor(deps, command.resident, command.requestId);

  if (found.authorId !== command.resident.id) {
    throw new DomainError('forbidden', 'Время визита выбирает тот, кто подал заявку');
  }

  const saved = await deps.repository.saveRequest(pickVisit(found, { at: command.at, now: deps.now() }));
  const zone = await zoneOf(deps, saved.buildingId);
  const assignee = saved.assigneeId ? await deps.repository.findResident(saved.assigneeId) : undefined;

  if (assignee) {
    await notifyResident(
      deps.notifier ?? noopNotifier,
      assignee,
      speakDefault()('app.visit.chosenForStaff', {
        номер: saved.number,
        когда: formatMoment(command.at, zone),
        место: describePlace(saved),
      }),
      [],
      { replyTo: saved.id },
    );
  }

  await recordAction(deps, {
    actor: command.resident,
    action: 'request_status',
    subject: saved.number,
    buildingId: saved.buildingId,
    details: `визит ${formatMoment(command.at, zone)}`,
  });

  return saved;
};

/** Жилец отменяет выбранное время: окна остаются, выбор начинается заново. @throws {DomainError} */
export const dropVisit = async (deps: AppDeps, resident: Resident, requestId: string): Promise<ServiceRequest> => {
  const found = await requestFor(deps, resident, requestId);

  if (found.authorId !== resident.id) {
    throw new DomainError('forbidden', 'Время визита отменяет тот, кто его выбирал');
  }

  const saved = await deps.repository.saveRequest(dropVisitSlot(found, deps.now()));
  const assignee = saved.assigneeId ? await deps.repository.findResident(saved.assigneeId) : undefined;

  if (assignee) {
    await notifyResident(
      deps.notifier ?? noopNotifier,
      assignee,
      speakDefault()('app.visit.dropped', { номер: saved.number }),
      [],
      { replyTo: saved.id },
    );
  }

  await tellAboutOffer(deps, saved);

  return saved;
};

/**
 * Время, названное словами: «давайте завтра утром». Кнопки видят не все, и
 * человек пишет так, как сказал бы по телефону. Пусто означает, что из
 * предложенных окон ничего не подошло: тогда ему честно об этом говорят.
 */
export const visitByWords = async (
  deps: AppDeps,
  request: ServiceRequest,
  said: string,
  /** Язык того, кто пишет: окна уходят модели теми же словами, что и человеку. */
  t: Translate = speakDefault(),
): Promise<Date | undefined> => {
  const slots = request.appointment?.slots ?? [];

  if (slots.length === 0) return undefined;

  const zone = await zoneOf(deps, request.buildingId);
  const key = await pickTimeByWords(deps.reasoner, {
    said,
    slots: slots.map((slot) => ({ key: slot.toISOString(), title: formatMoment(slot, zone, t) })),
  });

  return key ? new Date(key) : undefined;
};

export interface MissedVisitCommand {
  staff: Resident;
  requestId: string;
  /** Что мастер увидел на месте: записывается в историю заявки. */
  comment?: string;
}

/**
 * Мастер приехал и не попал в квартиру. Заявка ждёт жильца: срок выполнения
 * не идёт, пока время не согласовано заново. @throws {DomainError}
 */
export const missedVisit = async (deps: AppDeps, command: MissedVisitCommand): Promise<ServiceRequest> => {
  const found = await requestFor(deps, command.staff, command.requestId);

  if (!isCompanyStaff(command.staff.role)) {
    throw new DomainError('forbidden', 'Неудачный выезд отмечает управляющая организация');
  }

  const now = deps.now();
  const zone = await zoneOf(deps, found.buildingId);
  const failed = missVisit(found, { at: now, actorId: command.staff.id });

  // Заявка возвращается жильцу: без согласованного времени работа не идёт,
  // и это ожидание жильца, а не простой компании.
  const asked =
    failed.status === 'in_progress' || failed.status === 'accepted'
      ? applyTransition(failed, {
          to: 'needs_info',
          role: command.staff.role,
          actorId: command.staff.id,
          at: now,
          comment:
            command.comment?.trim() ||
            `Мастер приезжал ${formatMoment(now, zone)}, в квартиру попасть не удалось. Выберите другое время.`,
        })
      : failed;

  const saved = await deps.repository.saveRequest(asked);
  const author = await authorOf(deps, saved);

  if (author) {
    const t = speak(author);
    const text = accessRefused(saved)
      ? t('app.visit.refused', { номер: saved.number, сколько: MISSED_VISIT_LIMIT })
      : t('app.visit.missed', { номер: saved.number, когда: formatMoment(now, zone, t) });

    await notifyResident(deps.notifier ?? noopNotifier, author, text, [], { replyTo: saved.id });
  }

  await recordAction(deps, {
    actor: command.staff,
    action: 'request_status',
    subject: saved.number,
    buildingId: saved.buildingId,
    details: `не попали в квартиру, попыток ${missedVisits(saved)}`,
  });

  return saved;
};

/**
 * Напоминание о визите в день визита. Человек выбирал время три дня назад
 * и успел про него забыть, а мастер приезжает в пустую квартиру. Уходит один
 * раз за утро обходом дома: и жильцу, и исполнителю.
 */
export const remindAboutVisits = async (deps: AppDeps, buildingId: string): Promise<ServiceRequest[]> => {
  const now = deps.now();
  const zone = await zoneOf(deps, buildingId);
  const open = await deps.repository.listRequests({ buildingId, statuses: [...OPEN_STATUSES] });

  const soon = open.filter((request) => {
    const at = request.appointment?.at;

    return at !== undefined && daysApart(at, now, zone) === 0 && at.getTime() > now.getTime();
  });

  const notifier = deps.notifier ?? noopNotifier;

  for (const request of soon) {
    const at = request.appointment!.at!;
    const author = await authorOf(deps, request);
    const assignee = request.assigneeId ? await deps.repository.findResident(request.assigneeId) : undefined;

    if (author) {
      const t = speak(author);

      await notifyResident(
        notifier,
        author,
        t('app.visit.todayForResident', { номер: request.number, время: formatClock(at, zone, t) }),
        [],
        { replyTo: request.id },
      );
    }

    if (assignee) {
      await notifyResident(
        notifier,
        assignee,
        speakDefault()('app.visit.todayForStaff', {
          номер: request.number,
          время: formatClock(at, zone),
          место: describePlace(request),
        }),
        [],
        { replyTo: request.id },
      );
    }
  }

  return soon;
};

/**
 * Заявка ушла в работу: если работы в квартире, жильцу сразу предлагается
 * время. Отказ предложения заявку не роняет: время согласуют позже.
 */
export const offerVisitOnStart = async (deps: AppDeps, request: ServiceRequest, staff: Resident): Promise<void> => {
  if (request.status !== 'in_progress' || !needsAccess(request) || request.appointment?.at) return;

  await proposeVisit(deps, staff, request.id).catch(() => undefined);
};
