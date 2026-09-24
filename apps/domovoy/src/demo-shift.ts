import { transitionRequest, type AppDeps } from '@domovoy/app';
import type { RequestStatus, ServiceRequest } from '@domovoy/domain';

import { demoData } from './demo.js';

/**
 * Виртуальная смена демонстрационной установки. Проверяющий один и оставляет
 * заявку жильцом, а дальше ничего не происходит, пока он сам не переключится
 * в диспетчера и мастера. Смена набора ведёт его заявку с настоящими паузами:
 * диспетчер принимает, мастер берёт в работу и сдаёт. Так же идёт авария, к
 * которой он присоединился как сосед. Уведомления жильцу отправляет сам продукт,
 * как при обычных переходах; принять работу и оценить её человек должен сам.
 */

/** Сколько ждёт каждый шаг, считая от предыдущего перехода. */
export const SHIFT_PAUSES_MS = {
  accept: 30_000,
  start: 20_000,
  finish: 90_000,
} as const;

/** Заявки, в которые человек пришёл раньше этого, смена не трогает: это прошлая проверка. */
const FRESH_MS = 2 * 60 * 60_000;

const OPEN: RequestStatus[] = ['new', 'accepted', 'needs_info', 'in_progress'];

const DISPATCHER_MAX_ID = 2001;
const TECHNICIAN_MAX_ID = 2002;

const FINISHED = 'Мастер проверил на месте и устранил неисправность. Если что-то не так, верните заявку в работу.';

/** Когда в заявке появился настоящий человек: подал её сам или присоединился как сосед. */
const joinedAt = async (deps: AppDeps, request: ServiceRequest, demo: Set<number | undefined>): Promise<number | undefined> => {
  const real = async (id: string): Promise<boolean> => {
    const person = await deps.repository.findResident(id);

    return person !== undefined && person.role === 'resident' && person.maxUserId !== undefined && !demo.has(person.maxUserId);
  };

  if (await real(request.authorId)) return request.createdAt.getTime();

  for (const join of [...request.joinedBy].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (await real(join.residentId)) return join.at.getTime();
  }

  return undefined;
};

const lastMove = (request: ServiceRequest, since: number): number =>
  Math.max(since, ...request.history.filter((event) => !event.kind).map((event) => event.at.getTime()));

/** Один проход: каждая заявка настоящего человека сдвигается не больше чем на шаг. */
export const advanceDemoShift = async (deps: AppDeps): Promise<number> => {
  const now = deps.now().getTime();
  const demo = new Set(demoData().residents.map((resident) => resident.maxUserId));
  const dispatcher = await deps.repository.findResidentByMaxUserId(DISPATCHER_MAX_ID);
  const technician = await deps.repository.findResidentByMaxUserId(TECHNICIAN_MAX_ID);

  if (!dispatcher || !technician) return 0;

  let moved = 0;

  for (const request of await deps.repository.listRequests({ statuses: OPEN })) {
    const since = await joinedAt(deps, request, demo);

    // Заявки набора без проверяющего живут своей жизнью, давние не трогаются.
    if (since === undefined || now - since > FRESH_MS) continue;

    const waited = now - lastMove(request, since);

    try {
      if (request.status === 'new' && waited >= SHIFT_PAUSES_MS.accept) {
        await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'accepted' });
      } else if ((request.status === 'accepted' || request.status === 'needs_info') && waited >= SHIFT_PAUSES_MS.start) {
        await transitionRequest(deps, {
          resident: dispatcher,
          requestId: request.id,
          to: 'in_progress',
          assigneeId: technician.id,
        });
      } else if (request.status === 'in_progress' && waited >= SHIFT_PAUSES_MS.finish) {
        await transitionRequest(deps, { resident: technician, requestId: request.id, to: 'done', comment: FINISHED });
      } else {
        continue;
      }

      moved += 1;
    } catch (error) {
      // Заявка другого дома или переход, закрытый правилами: смена её пропускает.
      console.warn(`Виртуальная смена пропустила заявку ${request.id}`, error);
    }
  }

  return moved;
};
