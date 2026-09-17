import { DomainError, isCompanyStaff } from '@domovoy/domain';

import { homeBuildingOf } from './buildings.js';
import { recordAction } from './audit.js';
import { lastMonth, readingsCsv } from './export.js';
import { exportRequests } from './report.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { zoneOf } from './zone.js';

/**
 * Выгрузка приходит файлом в переписку с ботом. В клиенте MAX это надёжнее
 * скачивания из мини-приложения: файл остаётся в чате, его пересылают и открывают
 * на любом устройстве.
 */
export interface SentExport {
  filename: string;
  /** Сообщение с файлом в переписке. */
  messageId?: string;
}

const sendCsv = async (
  deps: AppDeps,
  resident: Resident,
  file: { filename: string; csv: string },
  text: string,
): Promise<SentExport> => {
  if (!resident.maxUserId) {
    throw new DomainError('user_unknown', 'Некуда отправить: профиль без учётной записи MAX');
  }

  const notifier = deps.notifier;

  if (!notifier?.sendFile) throw new DomainError('stickers_unavailable', 'Отправка файлов не настроена');

  const messageId = await notifier.sendFile({
    maxUserId: resident.maxUserId,
    as: 'document',
    name: file.filename,
    contentType: 'text/csv; charset=utf-8',
    content: file.csv,
    encoding: 'utf8',
    text,
  });

  return { filename: file.filename, ...(messageId ? { messageId } : {}) };
};

/** Реестр заявок за период файлом в переписку. @throws {DomainError} */
export const sendRequestsExport = async (
  deps: AppDeps,
  resident: Resident,
  days?: number,
): Promise<SentExport> => {
  if (!isCompanyStaff(resident.role)) throw new DomainError('forbidden', 'Реестр заявок доступен смене');

  const file = await exportRequests(deps, resident, days);
  const sent = await sendCsv(deps, resident, file, 'Реестр заявок');

  await recordAction(deps, {
    actor: resident,
    action: 'data_exported',
    subject: file.filename,
    buildingId: resident.buildingId ?? deps.defaultBuildingId,
  });

  return sent;
};

/** Показания дома за прошлый месяц файлом в переписку. @throws {DomainError} */
export const sendReadingsExport = async (deps: AppDeps, resident: Resident): Promise<SentExport> => {
  if (!isCompanyStaff(resident.role)) throw new DomainError('forbidden', 'Показания дома доступны смене');

  const buildingId = resident.buildingId ?? (await homeBuildingOf(deps, resident));
  const period = lastMonth(deps.now(), await zoneOf(deps, buildingId));
  const file = await readingsCsv(deps, buildingId, period);
  const sent = await sendCsv(deps, resident, file, 'Показания за прошлый месяц');

  await recordAction(deps, {
    actor: resident,
    action: 'data_exported',
    subject: file.filename,
    buildingId,
  });

  return sent;
};
