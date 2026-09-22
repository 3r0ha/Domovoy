import { DomainError, isCompanyStaff } from '@domovoy/domain';

import type { ConnectionRequest, Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/**
 * Дом, которого в продукте ещё нет. Человек, чья управляющая организация
 * не подключена, до сих пор упирался в тупик: код из квитанции ему взять
 * неоткуда, и продукт для него пустой. Он оставляет адрес, компания видит
 * список и решает, к кому идти.
 */

/** Сколько знаков помещается в адрес. */
export const ADDRESS_MAX_LENGTH = 200;

/** Сколько знаков помещается в название организации. */
export const COMPANY_MAX_LENGTH = 120;

export interface ConnectCommand {
  resident: Resident;
  address: string;
  company?: string;
  phone?: string;
}

/** Оставить просьбу подключить дом. Повторная заменяет прежнюю. @throws {DomainError} */
export const askToConnect = async (deps: AppDeps, command: ConnectCommand): Promise<ConnectionRequest> => {
  const address = command.address.trim().slice(0, ADDRESS_MAX_LENGTH);

  if (address.length < 5) {
    throw new DomainError('text_empty', 'Напишите адрес дома: город, улица, номер');
  }

  const company = command.company?.trim().slice(0, COMPANY_MAX_LENGTH);
  const known = await deps.repository.findConnectionRequest(command.resident.id);

  return deps.repository.saveConnectionRequest({
    id: known?.id ?? deps.createId(),
    residentId: command.resident.id,
    address,
    ...(company ? { company } : {}),
    ...(command.phone?.trim() ? { phone: command.phone.trim() } : {}),
    at: deps.now(),
  });
};

/** Просьба, которую человек уже оставил. */
export const ownConnectionRequest = async (
  deps: AppDeps,
  resident: Resident,
): Promise<ConnectionRequest | undefined> => deps.repository.findConnectionRequest(resident.id);

/** Сколько просьб показывать управляющему за раз. */
export const CONNECTION_PAGE = 50;

/** Дома, которых ждут. @throws {DomainError} */
export const listConnectionRequests = async (
  deps: AppDeps,
  staff: Resident,
  limit = CONNECTION_PAGE,
): Promise<ConnectionRequest[]> => {
  if (!isCompanyStaff(staff.role)) {
    throw new DomainError('forbidden', 'Список домов, которых ждут, виден управляющей организации');
  }

  return deps.repository.listConnectionRequests(limit);
};
