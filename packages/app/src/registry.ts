import { CATEGORY_RULES, STATUS_TITLES, describeTarget, isFinal, type ServiceRequest } from '@domovoy/domain';

import type { Building } from './repository.js';
import type { AppDeps } from './use-cases.js';

/**
 * Обмен с внешним реестром: ГИС ЖКХ и учётная система управляющей организации.
 * Заявки и обращения компания обязана вести в государственной системе, и
 * двойной ввод её же руками сводит на нет любую выгоду от продукта. Поэтому
 * продукт отдаёт заявки наружу сам, по тому же принципу, что и передачу
 * смежным организациям: за портом стоит адаптер, в репозитории, заглушка.
 */

export interface RegistryGateway {
  /** Как система называется в журнале: `gis_zhkh`, `1c`, `erp`. */
  readonly channel: string;
  /** Обмен модельный: настоящей выгрузки за ним нет. */
  readonly model: boolean;
  push(batch: RegistryBatch): Promise<RegistryReceipt>;
}

/** Заявка в виде, в котором её принимает внешний реестр. */
export interface RegistryRecord {
  /** Номер заявки в продукте: по нему обе стороны и сверяются. */
  number: string;
  /** Адрес дома. */
  address: string;
  /** Где именно: подъезд, стояк, квартира, оборудование. */
  place: string;
  category: string;
  status: string;
  /** Заявка закрыта: в реестре у неё стоит дата закрытия. */
  closed: boolean;
  createdAt: string;
  dueAt: string;
  closedAt?: string;
  description: string;
  /** Сколько жильцов сообщили о том же. */
  reporters: number;
}

export interface RegistryBatch {
  buildingId: string;
  address: string;
  /** С какого момента собраны изменения. */
  since: string;
  records: RegistryRecord[];
}

export interface RegistryReceipt {
  /** Сколько записей приняла внешняя система. */
  accepted: number;
  /** Что она не приняла и почему. */
  rejected?: { number: string; reason: string }[];
}

/** Когда заявка закрылась: последний переход в завершённое состояние. */
const closedAt = (request: ServiceRequest): Date | undefined =>
  isFinal(request.status)
    ? request.history.filter((event) => event.kind !== 'message').at(-1)?.at
    : undefined;

/** Заявка строкой реестра. */
export const registryRecord = (request: ServiceRequest, address: string): RegistryRecord => {
  const closed = closedAt(request);

  return {
    number: request.number,
    address,
    place: describeTarget(request.target),
    category: CATEGORY_RULES[request.category].title,
    status: STATUS_TITLES[request.status],
    closed: isFinal(request.status),
    createdAt: request.createdAt.toISOString(),
    dueAt: request.resolutionDueAt.toISOString(),
    ...(closed ? { closedAt: closed.toISOString() } : {}),
    description: request.description,
    reporters: request.joinedBy.length + 1,
  };
};

/** Заявки, в которых что-то менялось с этого момента. */
const changedSince = (requests: readonly ServiceRequest[], since: Date): ServiceRequest[] =>
  requests.filter((request) => {
    const last = request.history.at(-1)?.at ?? request.createdAt;

    return last.getTime() >= since.getTime();
  });

/**
 * Отдать изменения дома во внешний реестр. Без подключённого адаптера ничего
 * не происходит: продукт работает и без обмена, а выгрузка файлом остаётся.
 */
export const pushToRegistry = async (deps: AppDeps, buildingId: string, since: Date): Promise<number> => {
  if (!deps.registry) return 0;

  const building = await deps.repository.findBuilding(buildingId);
  const requests = await deps.repository.listRequests({ buildingId, createdAfter: monthBefore(since) });
  const records = changedSince(requests, since).map((request) =>
    registryRecord(request, addressOf(building)),
  );

  if (records.length === 0) return 0;

  const receipt = await deps.registry
    .push({ buildingId, address: addressOf(building), since: since.toISOString(), records })
    .catch(() => undefined);

  return receipt?.accepted ?? 0;
};

/** Адрес дома для внешней системы: без него запись не опознать. */
const addressOf = (building: Building | undefined): string => building?.address ?? '';

/** Насколько назад читать заявки: обмен идёт по изменениям, а не по дате подачи. */
const monthBefore = (at: Date): Date => new Date(at.getTime() - 31 * 24 * 3600_000);
