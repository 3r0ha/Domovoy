import {
  DomainError,
  canDispute,
  disputeRejection,
  rejectionReason,
  type ServiceRequest,
} from '@domovoy/domain';

import { recordAction } from './audit.js';
import { speak, speakDefault } from './language.js';
import { describePlace, noopNotifier, notifyAbout, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { canView } from './use-cases/access.js';

/**
 * Несогласие с отказом. Отказ закрывает заявку, и до сих пор заявителю
 * оставалось завести такую же заново. Теперь отказ один раз возвращается
 * на пересмотр, а оставленный в силе становится основанием для инспекции.
 */

export interface DisputeCommand {
  resident: Resident;
  requestId: string;
  /** Почему заявитель не согласен с отказом. */
  comment: string;
}

/** Можно ли оспорить отказ: по этому продукт и показывает кнопку. */
export const disputable = (deps: AppDeps, resident: Resident, request: ServiceRequest): boolean =>
  canDispute(request, resident.id, deps.now()).possible && canView(resident, request);

/** Заявитель не согласен с отказом: заявка возвращается в работу. @throws {DomainError} */
export const disputeRequest = async (deps: AppDeps, command: DisputeCommand): Promise<ServiceRequest> => {
  const found = await deps.repository.findRequest(command.requestId);

  if (!found || !canView(command.resident, found)) {
    throw new DomainError('request_not_found', 'Заявка не найдена');
  }

  const saved = await deps.repository.saveRequest(
    disputeRejection(found, { residentId: command.resident.id, comment: command.comment, at: deps.now() }),
  );

  await tellStaff(deps, saved, command);

  await recordAction(deps, {
    actor: command.resident,
    action: 'request_status',
    subject: saved.number,
    buildingId: saved.buildingId,
    details: `не согласен с отказом: ${command.comment.trim()}`,
  });

  return saved;
};

/** Пересмотр ведёт управляющий: отказ уже один раз дал диспетчер. */
const tellStaff = async (deps: AppDeps, request: ServiceRequest, command: DisputeCommand): Promise<void> => {
  const notifier = deps.notifier ?? noopNotifier;
  const t = speakDefault();
  const text = t('app.dispute.forStaff', {
    номер: request.number,
    место: describePlace(request),
    причина: rejectionReason(request) ?? '',
    что: command.comment.trim(),
  });

  const staff = await deps.repository.listStaff(request.buildingId);

  for (const person of staff.filter((item) => item.role === 'manager' || item.role === 'dispatcher')) {
    await notifyResident(notifier, person, text, [], { replyTo: request.id });
  }
};

/** Отказ оставлен в силе: жильцу объясняют, что дальше решает надзор. */
export const tellRejectionUpheld = async (deps: AppDeps, request: ServiceRequest): Promise<void> => {
  const author = await deps.repository.findResident(request.authorId);

  if (!author) return;

  const t = speak(author);

  await notifyAbout(deps.notifier ?? noopNotifier, author, t('app.dispute.upheld', { номер: request.number }), {
    complaintFor: request.id,
  });
};
