import {
  audienceForTarget,
  DomainError,
  elderNow,
  hasReported,
  isCompanyStaff,
  type RequestTarget,
  type ServiceRequest,
} from '@domovoy/domain';

import { apartmentsOf } from '../apartments.js';
import { assertServes, servedBy } from '../buildings.js';
import { type Resident } from '../repository.js';
import { type AppDeps } from './deps.js';
import { targetOf, type CreateRequestCommand } from './requests.js';

/** Писать в заявку и двигать её вправе те, кого она касается лично. */
export const canAct = (resident: Resident, request: ServiceRequest): boolean => {
  if (hasReported(request, resident.id)) return true;

  if (resident.role === 'resident') return false;

  if (resident.role === 'contractor') return request.assigneeId === resident.id;

  return true;
};

/** Подъезд, за который отвечает старший: кровля и подвал общие для всего дома. */
export const entranceOf = (target: RequestTarget): number | undefined => {
  const audience = audienceForTarget(target);

  return audience?.kind === 'entrance' || audience?.kind === 'riser' ? audience.entrance : undefined;
};

/**
 * Право распоряжаться заявкой с учётом полномочий старшего по подъезду:
 * работу по общему имуществу подъезда принимает он, даже если заявку заводил не он.
 */
export const canActNow = async (deps: AppDeps, resident: Resident, request: ServiceRequest): Promise<boolean> => {
  if (canAct(resident, request)) return true;
  if (resident.role !== 'resident') return false;

  const entrance = entranceOf(request.target);

  if (entrance === undefined) return false;

  const elder = elderNow(await deps.repository.listElderships(request.buildingId), entrance, deps.now());

  return elder?.residentId === resident.id;
};

/** Заявку по общему имуществу видит весь дом: о ней и объявляют всему дому. */
export const canView = (resident: Resident, request: ServiceRequest): boolean => {
  if (canAct(resident, request)) return true;

  return (
    resident.role === 'resident' && request.target.kind !== 'apartment' && request.buildingId === resident.buildingId
  );
};

/**
 * Сотрудник ведёт заявки домов своей организации. Свою собственную заявку
 * он ведёт как жилец, где бы она ни была подана. @throws {DomainError}
 */
export const assertStaffServes = async (deps: AppDeps, resident: Resident, request: ServiceRequest): Promise<void> => {
  if (resident.role === 'resident' || hasReported(request, resident.id)) return;

  if (resident.role === 'contractor') {
    if (request.assigneeId !== resident.id) throw new DomainError('forbidden', 'Этот наряд поручен не вам');

    return;
  }

  await assertServes(deps, resident, request.buildingId);
};

/**
 * Заявку от чужой квартиры заводит смена того дома: диспетчер принимает звонок
 * и оформляет обращение от квартиры, из которой позвонили. Жилец называет
 * только свою квартиру: соседу заявка приходит как своя и видна в его списке.
 *
 * Проверяется итоговый адрес заявки: квартиру называет и поле запроса, и код
 * с наклейки, а прежде смотрели только на поле. @throws {DomainError}
 */
export const assertMayTargetApartment = async (deps: AppDeps, command: CreateRequestCommand): Promise<void> => {
  const { resident } = command;
  const target = targetOf(command);

  if (target?.kind !== 'apartment') return;
  if (apartmentsOf(resident).includes(target.apartmentId)) return;

  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'Заявку по чужой квартире заводит управляющая компания этого дома');
  }

  const apartment = await deps.repository.findApartment(target.apartmentId);

  if (!apartment) throw new DomainError('apartment_unknown', 'Квартира не найдена');

  if (!servedBy(resident, deps).includes(apartment.buildingId)) {
    throw new DomainError('forbidden', 'Заявку по чужому дому заводит управляющая организация этого дома');
  }
};
