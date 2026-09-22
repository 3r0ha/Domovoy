import { DomainError, hasReported, isCompanyStaff } from '@domovoy/domain';

import { assertServes } from './buildings.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

const DIGITS = /^\+?\d{10,15}$/;

/** Телефон жильца для аварийного вызова. @throws {DomainError} */
export const saveContact = async (deps: AppDeps, resident: Resident, phone: string): Promise<Resident> => {
  const normalized = phone.replace(/[\s()-]/g, '');

  if (!DIGITS.test(normalized)) throw new DomainError('phone_invalid', 'Телефон не похож на номер');

  return deps.repository.saveResident({ ...resident, phone: normalized });
};

export const forgetContact = async (deps: AppDeps, resident: Resident): Promise<Resident> => {
  const without = { ...resident };

  delete without.phone;

  return deps.repository.saveResident(without);
};

/** Телефон автора заявки: сотрудникам своей компании и только по открытой заявке. @throws {DomainError} */
export const contactForRequest = async (
  deps: AppDeps,
  staff: Resident,
  requestId: string,
): Promise<{ displayName: string; phone?: string }> => {
  if (!isCompanyStaff(staff.role)) throw new DomainError('forbidden', 'Телефон жильца видит управляющая организация');

  const request = await deps.repository.findRequest(requestId);

  if (!request) throw new DomainError('request_not_found', 'Заявка не найдена');

  await assertServes(deps, staff, request.buildingId);

  const author = await deps.repository.findResident(request.authorId);

  if (!author || !hasReported(request, author.id)) {
    throw new DomainError('resident_unknown', 'Автор заявки не найден');
  }

  return { displayName: author.displayName, ...(author.phone ? { phone: author.phone } : {}) };
};
