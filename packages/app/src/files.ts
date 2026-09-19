import { DomainError, isCompanyStaff, type Attachment, type ServiceRequest } from '@domovoy/domain';

import { servesBuilding } from './buildings.js';
import type { Resident, StoredFile } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Что продукт принимает от жильца. */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

/** Предел размера. */
export const MAX_FILE_BYTES = 1_500_000;

/** Токен вложения для файлов, которые лежат у нас, а не у платформы. */
const OWN_FILE_PREFIX = 'file:';

export const isOwnFile = (token: string): boolean => token.startsWith(OWN_FILE_PREFIX);

export const fileIdFromToken = (token: string): string => token.slice(OWN_FILE_PREFIX.length);

/** Приём снимка из мини-приложения. @throws {DomainError} */
export const uploadFile = async (
  deps: AppDeps,
  resident: Resident,
  input: { contentType: string; base64: string },
): Promise<Attachment> => {
  if (!ALLOWED_TYPES.has(input.contentType)) {
    throw new DomainError('file_type_not_allowed', 'К заявке прикладывают фотографию, а не файл');
  }

  const bytes = decode(input.base64);

  if (bytes.length === 0) throw new DomainError('file_empty', 'Файл пустой');

  if (bytes.length > MAX_FILE_BYTES) {
    throw new DomainError('file_too_large', 'Снимок слишком большой, сфотографируйте с меньшим разрешением');
  }

  const file: StoredFile = {
    id: deps.createId(),
    contentType: input.contentType,
    bytes,
    uploadedBy: resident.id,
    buildingId: resident.buildingId ?? deps.defaultBuildingId,
    at: deps.now(),
  };

  await deps.repository.saveFile(file);

  return { kind: 'photo', token: `${OWN_FILE_PREFIX}${file.id}` };
};

/** Выдача снимка. @throws {DomainError} */
export const readFile = async (deps: AppDeps, resident: Resident, id: string): Promise<StoredFile> => {
  const file = await deps.repository.findFile(id);

  if (!file) throw new DomainError('file_not_found', 'Файл не найден');

  if (file.uploadedBy === resident.id) return file;

  // Дом снимка сверяется с границей организации, а не с полем `buildingId`:
  // у сотрудника без дома им прежде оказывался дом установки.
  if (isCompanyStaff(resident.role) && (await servesBuilding(deps, resident, file.buildingId))) return file;

  if (await attachedToOwn(deps, resident, id)) return file;

  throw new DomainError('forbidden', 'Этот файл вам не принадлежит');
};

/** Есть ли этот файл среди вложений заявки: своих или из переписки по ней. */
const holds = (request: ServiceRequest, token: string): boolean =>
  request.attachments.some((item) => item.token === token) ||
  request.history.some((event) => event.attachments?.some((item) => item.token === token));

const attachedToOwn = async (deps: AppDeps, resident: Resident, id: string): Promise<boolean> => {
  const token = `${OWN_FILE_PREFIX}${id}`;
  const mine = await deps.repository.listRequests({ reporterId: resident.id });

  if (mine.some((request) => holds(request, token))) return true;

  if (!isCompanyStaff(resident.role)) return false;

  return (await deps.repository.listRequests({ assigneeId: resident.id })).some((request) =>
    holds(request, token),
  );
};

/** Разбор base64. */
const decode = (base64: string): Uint8Array => {
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;

  try {
    return Uint8Array.from(Buffer.from(payload, 'base64'));
  } catch {
    throw new DomainError('file_broken', 'Не удалось прочитать файл');
  }
};
