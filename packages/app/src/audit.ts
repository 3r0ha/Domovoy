import { DomainError } from '@domovoy/domain';

import type { AuditEntry, Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Что именно сделал сотрудник. */
export const AUDIT_ACTIONS = {
  role_assigned: 'Назначена роль',
  duty_changed: 'Дежурство',
  buildings_changed: 'Дома сотрудника',
  apartment_unbound: 'Отвязана квартира',
  door_opened: 'Открыта дверь',
  guest_code_revoked: 'Отозван гостевой код',
  reading_deleted: 'Удалено показание',
  reading_submitted: 'Показание за жильца',
  debt_reminded: 'Напоминание о долге',
  broadcast_sent: 'Рассылка жильцам',
  house_meter_added: 'Заведён общедомовой прибор',
  house_reading_submitted: 'Показание узла учёта',
  poll_started: 'Объявлено собрание',
  tariff_changed: 'Изменён тариф',
  request_rejected: 'Отклонена заявка',
  request_passed: 'Обращение передано смежной организации',
  data_exported: 'Выгрузка данных',
  data_imported: 'Заведён дом',
  building_updated: 'Изменена карточка дома',
  building_added: 'Заведён новый дом',
  visit_booked: 'Запись на приём',
  visit_cancelled: 'Отменена запись на приём',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export interface RecordInput {
  actor: Resident;
  action: AuditAction;
  /** Над чем действие: заявка, человек или прибор. */
  subject?: string;
  details?: string;
  buildingId?: string;
}

/** Записывает действие сотрудника. */
export const recordAction = async (deps: AppDeps, input: RecordInput): Promise<void> => {
  if (input.actor.role === 'resident') return;

  await deps.repository.saveAudit({
    id: deps.createId(),
    at: deps.now(),
    actorId: input.actor.id,
    actorName: input.actor.displayName,
    action: input.action,
    buildingId: input.buildingId ?? input.actor.buildingId ?? deps.defaultBuildingId,
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.details ? { details: input.details } : {}),
  });
};

/** Сколько записей журнала отдаём за раз. */
export const AUDIT_PAGE = 50;

export interface AuditPage {
  limit?: number;
  before?: Date;
}

/** Журнал действий по дому. @throws {DomainError} */
export const listAudit = async (deps: AppDeps, resident: Resident, page: AuditPage = {}): Promise<AuditEntry[]> => {
  if (resident.role !== 'manager') {
    throw new DomainError('forbidden', 'Журнал действий смотрит управляющий');
  }

  return deps.repository.listAudit(resident.buildingId ?? deps.defaultBuildingId, {
    limit: page.limit ?? AUDIT_PAGE,
    ...(page.before ? { before: page.before } : {}),
  });
};

/** Строка журнала словами. */
export const formatAudit = (entry: AuditEntry, timeZone: string): string => {
  const when = entry.at.toLocaleString('ru-RU', {
    timeZone,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  return [`${when} · ${entry.actorName}`, `${AUDIT_ACTIONS[entry.action]}${entry.subject ? `: ${entry.subject}` : ''}`]
    .concat(entry.details ? [entry.details] : [])
    .join('\n');
};
