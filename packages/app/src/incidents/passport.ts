import {
  assessDeadlineRisk,
  collectCategoryStats,
  decodeTarget,
  describeTarget,
  DomainError,
  isCompanyStaff,
  isFinal,
  isSameTarget,
  reportersCount,
  targetName,
  wearOf,
  type RequestTarget,
  type RiskAssessment,
  type ServiceRequest,
} from '@domovoy/domain';

import { apartmentsOf, locateTarget } from '../apartments.js';
import { servesBuilding } from '../buildings.js';
import { speak } from '../language.js';
import { translateForReading } from '../machine-translation.js';
import { type Resident } from '../repository.js';
import { withReadableAddress, type AppDeps } from '../use-cases.js';

export interface RequestWithRisk {
  request: ServiceRequest;
  assessment: RiskAssessment;
  reporters: number;
}

/** За сколько дней берётся история закрытых заявок для прогноза по категории. */
export const STATS_DAYS = 180;

/** Очередь с прогнозом. */
export const assessQueue = async (deps: AppDeps, requests: readonly ServiceRequest[]): Promise<RequestWithRisk[]> => {
  const now = deps.now();

  if (requests.length === 0) return [];

  // Прогноз строится по своему дому за полгода: чужая история о сроках здесь ничего не говорит.
  const houses = [...new Set(requests.map((request) => request.buildingId))];
  const since = new Date(now.getTime() - STATS_DAYS * 24 * 3600_000);

  const history = await Promise.all(
    houses.map((buildingId) =>
      deps.repository.listRequests({ buildingId, statuses: ['done', 'confirmed'], createdAfter: since }),
    ),
  );

  const stats = collectCategoryStats(history.flat());

  return requests.map((request) => ({
    request,
    assessment: assessDeadlineRisk(request, stats, now),
    reporters: reportersCount(request),
  }));
};

export interface ObjectPassport {
  /** Код объекта, как он записан на наклейке. */
  startParam: string;
  target: string;
  /** Открытые заявки по этому объекту: жильцу не нужно заводить ещё одну. */
  open: ServiceRequest[];
  /** Что чинили раньше. */
  history: ServiceRequest[];
  totalRequests: number;
  lastRepairAt?: Date;
  /** Как часто объект ломается и когда ждать следующего раза. */
  averageDays?: number;
  dueInDays?: number;
}

/**
 * Кому виден объект: смене в обслуживаемых домах, жильцу общее имущество его дома
 * и собственная квартира. Чужая квартира не показывается никому, кроме смены
 * того же дома: номера квартир предсказуемы, и без границы дома по ним читается
 * вся установка.
 */
const canSeeObject = async (
  deps: AppDeps,
  viewer: Resident,
  target: RequestTarget,
  buildingId: string,
): Promise<boolean> => {
  if (isCompanyStaff(viewer.role)) return servesBuilding(deps, viewer, buildingId);

  const own = apartmentsOf(viewer);
  const houses = new Set(viewer.buildingId ? [viewer.buildingId] : []);

  for (const apartmentId of own) {
    const apartment = await deps.repository.findApartment(apartmentId);

    if (apartment) houses.add(apartment.buildingId);
  }

  if (!houses.has(buildingId)) return false;

  return target.kind !== 'apartment' || own.includes(target.apartmentId);
};

/**
 * Наклейка называет дом. Человек, который ещё не привязал квартиру, до сих пор
 * не видел ни объявлений, ни контактов, ни аварий: продукт не знал, где он
 * живёт. Скан кода это и отвечает, поэтому дом запоминается. Квартиру он
 * не даёт: квитанция, показания и голос по-прежнему за кодом из квитанции.
 */
export const rememberHouseFromObject = async (
  deps: AppDeps,
  resident: Resident,
  startParam: string,
): Promise<Resident> => {
  if (resident.role !== 'resident' || resident.buildingId || apartmentsOf(resident).length > 0) return resident;

  const target = decodeTarget(startParam);
  const audience = target ? await locateTarget(deps, target) : null;

  if (!audience) return resident;

  return deps.repository.saveResident({ ...resident, buildingId: audience.buildingId });
};

/** Паспорт объекта: открытые заявки и история поломок. @throws {DomainError} */
export const objectPassport = async (
  deps: AppDeps,
  startParam: string,
  viewer: Resident,
): Promise<ObjectPassport | null> => {
  const target = decodeTarget(startParam);

  if (!target) return null;

  const audience = await locateTarget(deps, target);

  if (!audience) return null;

  if (!(await canSeeObject(deps, viewer, target, audience.buildingId))) {
    throw new DomainError('forbidden', 'Этот объект относится к другому дому');
  }

  const all = await deps.repository.listRequests({ buildingId: audience.buildingId });
  const sameObject = all.filter((request) => isSameTarget(request.target, target));

  const open = sameObject.filter((request) => !isFinal(request.status));

  const repaired = sameObject
    .filter((request) => request.status === 'confirmed')
    .map((request) => request.history.at(-1)?.at)
    .filter((at): at is Date => at instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime());

  const located = await withReadableAddress(deps, target);
  // Название оборудования взято из справочника дома: жильцу с другим языком
  // его переводит служба, а адрес и номер квартиры остаются как есть.
  const machine = await translateForReading(deps, viewer, [targetName(located)]);

  return {
    startParam,
    target: machine.of(describeTarget(located, undefined, speak(viewer))),
    open,
    history: [...sameObject].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
    totalRequests: sameObject.length,
    ...(repaired[0] ? { lastRepairAt: repaired[0] } : {}),
    ...wearOf(
      sameObject.map((request) => request.createdAt),
      deps.now(),
    ),
  };
};
