import {
  DomainError,
  OPEN_STATUSES,
  compareByUrgency,
  isCompanyStaff,
  type Material,
  type ServiceRequest,
} from '@domovoy/domain';

import { daysApart } from '@domovoy/i18n';

import { describePlace } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { zoneOf } from './zone.js';

/**
 * Рабочий день мастера. Наряды приходили по одному сообщением, а дня целиком
 * не было: мастер не видел, сколько объектов на нём и в каком порядке их
 * обходить. День собирается по согласованному времени визита, а где его нет,
 * по сроку, и держится адресами: соседние квартиры одного подъезда идут подряд.
 */

export interface WorkdayItem {
  requestId: string;
  number: string;
  title: string;
  /** Где: подъезд, стояк, квартира или оборудование. */
  place: string;
  /** Подъезд: по нему день и раскладывается. */
  entrance?: number;
  status: ServiceRequest['status'];
  priority: ServiceRequest['priority'];
  /** Согласованное время визита, если оно есть. */
  visitAt?: Date;
  dueAt: Date;
  /** Срок нарушен уже сейчас. */
  overdue: boolean;
  /** Что уже списано по заявке. */
  materials: Material[];
}

export interface Workday {
  /** На какой день собран: начало суток по времени дома. */
  day: Date;
  items: WorkdayItem[];
  /** Сколько заявок с согласованным временем. */
  appointed: number;
  /** Сколько просрочено. */
  overdue: number;
}

/**
 * Наряд сегодняшнего дня. День это не весь список: заявка со сроком через
 * неделю в сегодняшнем дне только мешает. В день попадают просроченные,
 * те, у кого срок сегодня или уже прошёл, и те, на которые жилец назначил
 * время визита на сегодня.
 */
const today = (request: ServiceRequest, now: Date, zone: string): boolean => {
  const visit = request.appointment?.at;

  if (visit) return daysApart(visit, now, zone) <= 0;

  return daysApart(request.resolutionDueAt, now, zone) <= 0;
};

/** Подъезд объекта: у оборудования и дома его может не быть. */
const entranceOf = (request: ServiceRequest): number | undefined =>
  request.target.kind === 'entrance' || request.target.kind === 'riser' ? request.target.entrance : undefined;

/**
 * День мастера: наряды в работе и принятые, по порядку обхода.
 * @throws {DomainError} если спрашивает не сотрудник.
 */
export const workdayFor = async (deps: AppDeps, staff: Resident): Promise<Workday> => {
  if (!isCompanyStaff(staff.role) && staff.role !== 'contractor') {
    throw new DomainError('forbidden', 'День собирается для исполнителя наряда');
  }

  const now = deps.now();
  const zone = await zoneOf(deps, staff.buildingId ?? deps.defaultBuildingId);
  const mine = await deps.repository.listRequests({ assigneeId: staff.id, statuses: [...OPEN_STATUSES] });

  const items = mine
    .filter((request) => request.status !== 'done' && today(request, now, zone))
    .map((request) => {
      const visit = request.appointment?.at;

      return {
        requestId: request.id,
        number: request.number,
        title: request.title,
        place: describePlace(request),
        ...(entranceOf(request) === undefined ? {} : { entrance: entranceOf(request) }),
        status: request.status,
        priority: request.priority,
        ...(visit ? { visitAt: visit } : {}),
        dueAt: request.resolutionDueAt,
        overdue: request.resolutionDueAt.getTime() < now.getTime(),
        materials: request.materials ?? [],
      } satisfies WorkdayItem;
    });

  // Сначала то, на что назначено время: туда мастера ждут. Остальное по сроку,
  // а внутри одного подъезда, подряд: лишний подъём на этаж это потерянный час.
  const ordered = [...items].sort((one, other) => {
    const byVisit = (one.visitAt?.getTime() ?? Infinity) - (other.visitAt?.getTime() ?? Infinity);

    if (byVisit !== 0) return byVisit;

    const byEntrance = (one.entrance ?? 0) - (other.entrance ?? 0);

    if (byEntrance !== 0) return byEntrance;

    return one.dueAt.getTime() - other.dueAt.getTime();
  });

  return {
    day: now,
    items: ordered,
    appointed: ordered.filter((item) => item.visitAt).length,
    overdue: ordered.filter((item) => item.overdue).length,
  };
};

/** Очередь смены по срочности: тем же порядком, что и в приложении. */
export const orderedQueue = (requests: readonly ServiceRequest[], now: Date): ServiceRequest[] =>
  [...requests].sort((left, right) => compareByUrgency(left, right, now));
