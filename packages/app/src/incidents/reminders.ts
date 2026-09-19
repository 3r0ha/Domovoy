import {
  acceptanceReminderCrossedIn,
  applyTransition,
  AUTO_CONFIRM_AFTER_HOURS,
  canEscalate,
  deadlineCrossedIn,
  isAutoConfirmDue,
  OPEN_STATUSES,
  reportedDoneAt,
  reporterIds,
  selectAudience,
  warningCrossedIn,
  worksCrossedIn,
  WORKS_WARNING_HOURS,
  type PlannedWork,
  type ServiceRequest,
  type WorksEvent,
} from '@domovoy/domain';

import { postTextToChat } from '../broadcast.js';
import { wanting } from '../notices.js';
import { rememberResidents } from '../people.js';
import {
  actionsFor,
  formatAcceptanceReminder,
  formatAutoConfirmed,
  formatBreachForStaff,
  formatDeadlineWarning,
  formatOverdue,
  formatWorksFinished,
  formatWorksSoon,
  formatWorksStarted,
  noopNotifier,
  notifyAbout,
  notifyResident,
} from '../notifier.js';
import { plannedWork } from '../repository.js';
import { type AppDeps } from '../use-cases.js';
import { notifyResponsible } from './notify.js';

/** Закрывает заявки, которые жилец не принял и не оспорил. */
export const closeAcceptedBySilence = async (deps: AppDeps): Promise<ServiceRequest[]> => {
  const waiting = await deps.repository.listRequests({ statuses: ['done'] });
  const now = deps.now();
  const personOf = rememberResidents(deps);
  const closed: ServiceRequest[] = [];

  for (const request of waiting) {
    if (!isAutoConfirmDue(request, now)) continue;

    const author = await personOf(request.authorId);

    if (!author) continue;

    const confirmed = await deps.repository.saveRequest(
      applyTransition(request, { to: 'confirmed', role: 'resident', actorId: author.id, at: now }),
    );

    const text = formatAutoConfirmed(confirmed, AUTO_CONFIRM_AFTER_HOURS);

    for (const id of reporterIds(confirmed)) {
      // Текст зовёт оформить новую заявку, если проблема осталась: кнопка ведёт туда же.
      await notifyResident(deps.notifier ?? noopNotifier, await personOf(id), text, [], { section: 'new' });
    }

    closed.push(confirmed);
  }

  return closed;
};

/** Напоминание о приёмке до автоматического закрытия. */
export const remindAboutAcceptance = async (deps: AppDeps, since: Date): Promise<ServiceRequest[]> => {
  const waiting = await deps.repository.listRequests({ statuses: ['done'] });
  const now = deps.now();
  const notifier = deps.notifier ?? noopNotifier;
  const personOf = rememberResidents(deps);
  const reminded: ServiceRequest[] = [];

  for (const request of waiting) {
    if (!acceptanceReminderCrossedIn(request, since, now)) continue;

    const doneAt = reportedDoneAt(request);
    const left = doneAt
      ? Math.max(1, Math.round(AUTO_CONFIRM_AFTER_HOURS - (now.getTime() - doneAt.getTime()) / 3600_000))
      : AUTO_CONFIRM_AFTER_HOURS;

    const text = formatAcceptanceReminder(request, left);

    for (const id of reporterIds(request)) {
      const resident = await personOf(id);

      await notifyResident(notifier, resident, text, resident ? actionsFor(request, resident) : undefined);
    }

    reminded.push(request);
  }

  return reminded;
};

/** Сроки, нарушенные с прошлой проверки. */
export const remindAboutOverdue = async (deps: AppDeps, since: Date): Promise<ServiceRequest[]> => {
  const now = deps.now();
  const open = await deps.repository.listRequests({ statuses: [...OPEN_STATUSES] });
  const notifier = deps.notifier ?? noopNotifier;
  const personOf = rememberResidents(deps);
  const notified: ServiceRequest[] = [];

  for (const request of open) {
    const crossed = deadlineCrossedIn(request, since, now);

    if (!crossed) continue;

    const escalatable = canEscalate(request, now).possible;
    const text = formatOverdue(request, crossed, escalatable);

    for (const id of reporterIds(request)) {
      await notifyAbout(notifier, await personOf(id), text, {
        section: 'list',
        ...(escalatable ? { complaintFor: request.id } : {}),
      });
    }

    await notifyResponsible(deps, request, formatBreachForStaff(request, crossed));

    notified.push(request);
  }

  return notified;
};

/** Срок вот-вот сгорит. */
export const warnAboutDeadlines = async (deps: AppDeps, since: Date): Promise<ServiceRequest[]> => {
  const now = deps.now();
  const open = await deps.repository.listRequests({ statuses: [...OPEN_STATUSES] });
  const warned: ServiceRequest[] = [];

  for (const request of open) {
    const approaching = warningCrossedIn(request, since, now);

    if (!approaching) continue;

    await notifyResponsible(deps, request, formatDeadlineWarning(request, approaching, now));
    warned.push(request);
  }

  return warned;
};

/** Сообщения о начале и окончании объявленных работ. */
export const remindAboutWorks = async (
  deps: AppDeps,
  buildingId: string,
  since: Date,
): Promise<{ work: PlannedWork; event: WorksEvent }[]> => {
  const now = deps.now();
  const notifier = deps.notifier ?? noopNotifier;
  const announcements = await deps.repository.listWorksBetween(
    buildingId,
    since,
    new Date(now.getTime() + WORKS_WARNING_HOURS * 3600_000),
  );
  const apartments = await deps.repository.listApartments(buildingId);
  const sent: { work: PlannedWork; event: WorksEvent }[] = [];

  for (const announcement of announcements) {
    const work = plannedWork(announcement);

    if (!work) continue;

    const event = worksCrossedIn(work, since, now);

    if (!event) continue;

    const affected = selectAudience(apartments, work.audience).map((apartment) => apartment.id);
    const residents = await deps.repository.listResidentsByApartments(affected);
    const text =
      event === 'soon'
        ? formatWorksSoon(work, now)
        : event === 'started'
          ? formatWorksStarted(work, now)
          : formatWorksFinished(work);

    // После завершённых работ человеку нужна заявка, если стало не лучше.
    const where = event === 'finished' ? { section: 'new' } : {};

    for (const resident of wanting(residents, 'works')) await notifyResident(notifier, resident, text, [], where);

    if (event === 'started') await postTextToChat(deps, buildingId, text, { pin: true });
    if (event === 'finished') await postTextToChat(deps, buildingId, text, { unpin: true });

    sent.push({ work, event });
  }

  return sent;
};
