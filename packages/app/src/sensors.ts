import { DomainError, encodeTarget, type RequestCategory, type RequestTarget } from '@domovoy/domain';

import { isSensor, type Device } from './devices.js';
import { submitProblem, type SubmitResult } from './incidents.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Что означает срабатывание: категория заявки и слова, которыми о ней говорят. */
const ALARMS: Partial<Record<Device['kind'], { category: RequestCategory; what: string }>> = {
  leak: { category: 'plumbing', what: 'Сработал датчик протечки' },
  smoke: { category: 'safety', what: 'Сработал датчик дыма' },
};

/** Срабатывание датчика всегда заводит аварийную заявку. */
const ALARM_PRIORITY = 'emergency' as const;

/** Автором заявки от датчика становится управляющая организация. */
const authorFor = async (deps: AppDeps, buildingId: string): Promise<Resident> => {
  const staff = await deps.repository.listStaff(buildingId);
  const author = staff.find((person) => person.role === 'manager') ?? staff[0];

  if (!author) throw new DomainError('staff_unknown', 'В доме нет сотрудников, от которых завести заявку');

  return author;
};

const targetOf = (device: Device): RequestTarget => {
  if (device.entrance !== undefined && device.riser !== undefined) {
    return { kind: 'riser', buildingId: device.buildingId, entrance: device.entrance, riser: device.riser };
  }

  if (device.entrance !== undefined) {
    return { kind: 'entrance', buildingId: device.buildingId, entrance: device.entrance };
  }

  return { kind: 'building', buildingId: device.buildingId };
};

/** Срабатывание датчика. @throws {DomainError} */
export const raiseSensorAlarm = async (deps: AppDeps, buildingId: string, deviceId: string): Promise<SubmitResult> => {
  if (!deps.hub) throw new DomainError('devices_unavailable', 'Умный дом не подключён');

  const device = (await deps.hub.list(buildingId)).find((item) => item.id === deviceId);

  if (!device || !isSensor(device)) throw new DomainError('device_not_found', 'Датчик не найден');

  const alarm = ALARMS[device.kind];

  if (!alarm) throw new DomainError('device_not_sensor', 'Это устройство не датчик');

  return submitProblem(deps, {
    resident: await authorFor(deps, buildingId),
    description: `${alarm.what}: ${device.title}`,
    title: alarm.what,
    category: alarm.category,
    priority: ALARM_PRIORITY,
    startParam: encodeTarget(targetOf(device)),
  });
};
