import { DomainError, formatClock, isCompanyStaff, type Apartment, type RequestTarget } from '@domovoy/domain';

import { recordAction } from './audit.js';
import { formatGuestEntry, noopNotifier, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

export type DeviceKind = 'intercom' | 'barrier' | 'camera' | 'leak' | 'smoke';

export interface Device {
  id: string;
  buildingId: string;
  kind: DeviceKind;
  title: string;
  /** Подъезд устройства. Пусто у общедомового. */
  entrance?: number;
  /** Стояк: у датчика протечки он и есть адрес заявки. */
  riser?: number;
  /** Когда оборудование последний раз выходило на связь. */
  lastSeenAt?: Date;
}

/** Сколько датчик может молчать, прежде чем считать его потерянным. */
export const SENSOR_SILENCE_HOURS = 24;

/** Датчик, который давно не выходил на связь. */
export const isSilent = (device: Device, now: Date): boolean =>
  isSensor(device) &&
  (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > SENSOR_SILENCE_HOURS * 60 * 60 * 1000);

/** Датчики: их не открывают и не смотрят, они сообщают сами. */
export const SENSOR_KINDS: readonly DeviceKind[] = ['leak', 'smoke'];

export const isSensor = (device: { kind: DeviceKind }): boolean => SENSOR_KINDS.includes(device.kind);

export interface DeviceEvent {
  deviceId: string;
  at: Date;
  residentId?: string;
  action: 'opened' | 'snapshot' | 'guest-code';
  by: 'resident' | 'guest';
}

export interface Snapshot {
  deviceId: string;
  at: Date;
  /** Кадр картинкой: внешней ссылки на подъезд не остаётся. */
  image: string;
}

export interface GuestCode {
  code: string;
  deviceId: string;
  expiresAt: Date;
  /** Кто выдал: по коду открывает гость, а отвечает за это житель. */
  issuedBy?: string;
}

/** Порт умного дома. */
export interface DeviceHub {
  /** Подключение модельное: за портом заглушка, а не оборудование дома. */
  readonly model?: boolean;
  list(buildingId: string): Promise<Device[]>;
  /** `residentId` пуст, когда дверь открыл гость по коду: имени у него нет. */
  open(deviceId: string, by: 'resident' | 'guest', residentId?: string): Promise<void>;
  snapshot(deviceId: string, residentId?: string): Promise<Snapshot>;
  issueGuestCode(deviceId: string, minutes: number, residentId?: string): Promise<GuestCode>;
  /** Открыть по коду. Возвращает `null`, если код просрочен или уже сработал. */
  openWithCode(code: string): Promise<GuestCode | null>;
  /** Коды, выданные этим человеком и ещё действующие. */
  activeCodes(residentId: string): Promise<GuestCode[]>;
  /** Погасить код досрочно, не дожидаясь истечения. */
  revokeCode(code: string): Promise<boolean>;
  /** Что происходило с оборудованием дома: журнал для управляющей компании. */
  journal(buildingId: string): Promise<DeviceEvent[]>;
}

/** Сколько минут живёт гостевой код. */
export const GUEST_CODE_MINUTES = 15;

export interface DeviceDeps {
  hub?: DeviceHub;
  now: () => Date;
  /** Нужен, чтобы найти дом квартиры: у сотрудника он может быть не рабочим. */
  repository?: { findApartment: (apartmentId: string) => Promise<Apartment | undefined> };
}

/** Дом и подъезд квартиры человека. */
const homeSpot = async (
  deps: DeviceDeps,
  resident: Resident,
): Promise<{ buildingId: string; entrance: number } | undefined> => {
  if (!deps.repository || !resident.apartmentId) return undefined;

  const apartment = await deps.repository.findApartment(resident.apartmentId);

  return apartment ? { buildingId: apartment.buildingId, entrance: apartment.entrance } : undefined;
};

/** Подключённая домофония. @throws {DomainError} */
const hub = (deps: DeviceDeps): DeviceHub => {
  if (!deps.hub) throw new DomainError('devices_unavailable', 'Умный дом не подключён');

  return deps.hub;
};

/** Обращение к домофонии: её отказ превращается в «служба недоступна». @throws {DomainError} */
const ask = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch {
    throw new DomainError('devices_unavailable', 'Умный дом сейчас не отвечает, попробуйте позже');
  }
};

/** Дома, оборудование которых человеку доступно: рабочий у смены и свой у жильца. */
const housesOf = async (deps: DeviceDeps, resident: Resident): Promise<string[]> => {
  const home = await homeSpot(deps, resident);

  if (resident.role === 'contractor') return home ? [home.buildingId] : [];

  return [
    ...new Set(
      [isCompanyStaff(resident.role) ? resident.buildingId : undefined, home?.buildingId ?? resident.buildingId].filter(
        (id): id is string => id !== undefined,
      ),
    ),
  ];
};

/** Жильцу свой подъезд и общедомовое, сотруднику всё оборудование дома. */
export const devicesFor = async (
  deps: DeviceDeps,
  resident: Resident,
  entrance: number | undefined,
): Promise<Device[]> => {
  const hub = deps.hub;

  if (!hub) return [];

  const staff = isCompanyStaff(resident.role) && resident.role !== 'contractor';
  const home = (await homeSpot(deps, resident)) ?? {
    buildingId: resident.buildingId ?? '',
    entrance: entrance ?? Number.NaN,
  };
  const found = new Map<string, Device>();

  for (const buildingId of await housesOf(deps, resident)) {
    const own = staff && buildingId === resident.buildingId;

    for (const device of await ask(() => hub.list(buildingId))) {
      if (isSensor(device)) continue;
      if (!own && device.entrance !== undefined && device.entrance !== home.entrance) continue;

      found.set(device.id, device);
    }
  }

  return [...found.values()];
};

/** Устройства, относящиеся к объекту с наклейки. */
export const devicesAt = async (deps: DeviceDeps, buildingId: string, target: RequestTarget): Promise<Device[]> => {
  const hub = deps.hub;

  if (!hub) return [];

  const all = await ask(() => hub.list(buildingId));
  const entrance = target.kind === 'entrance' || target.kind === 'riser' ? target.entrance : undefined;

  if (entrance === undefined) return [];

  return all.filter((device) => device.entrance === entrance && !isSensor(device));
};

/** @throws {DomainError} если устройство не относится к дому и подъезду человека. */
const deviceFor = async (deps: DeviceDeps, resident: Resident, deviceId: string): Promise<Device> => {
  const hub = deps.hub;

  if (!hub) throw new DomainError('devices_unavailable', 'Умный дом не подключён');

  const staff = isCompanyStaff(resident.role) && resident.role !== 'contractor';
  const home = await homeSpot(deps, resident);

  for (const buildingId of await housesOf(deps, resident)) {
    const own = staff && buildingId === resident.buildingId;
    const found = (await ask(() => hub.list(buildingId))).find((device) => device.id === deviceId);

    if (!found) continue;
    // Отбор тот же, что и в списке устройств: домофон и камера соседнего
    // подъезда жильцу не принадлежат, даже если он знает идентификатор.
    if (!own && found.entrance !== undefined && found.entrance !== home?.entrance) continue;

    return found;
  }

  throw new DomainError('device_not_found', 'Устройство не найдено');
};

/** @throws {DomainError} */
export const openDevice = async (deps: AppDeps, resident: Resident, deviceId: string): Promise<Device> => {
  const device = await deviceFor(deps, resident, deviceId);

  if (device.kind === 'camera') {
    throw new DomainError('device_not_openable', 'Камеру открыть нельзя');
  }

  await ask(() => hub(deps).open(device.id, 'resident', resident.id));

  await recordAction(deps, { actor: resident, action: 'door_opened', subject: device.title });

  return device;
};

/** @throws {DomainError} */
export const viewDevice = async (deps: DeviceDeps, resident: Resident, deviceId: string): Promise<Snapshot> => {
  const device = await deviceFor(deps, resident, deviceId);

  if (device.kind !== 'camera') {
    throw new DomainError('device_not_viewable', 'У этого устройства нет камеры');
  }

  return ask(() => hub(deps).snapshot(device.id, resident.id));
};

/** Кадр приходит ссылкой `data:`: из неё собирается файл для переписки. */
const fromDataUrl = (url: string): { contentType: string; content: string; encoding: 'utf8' | 'base64' } | undefined => {
  const parsed = /^data:([^;,]+)(;[^,]*)?,([\s\S]*)$/.exec(url);

  if (!parsed) return undefined;

  const contentType = parsed[1] ?? 'application/octet-stream';
  const body = parsed[3] ?? '';

  return (parsed[2] ?? '').includes('base64')
    ? { contentType, content: body, encoding: 'base64' }
    : { contentType, content: decodeURIComponent(body), encoding: 'utf8' };
};

export interface SentSnapshot {
  title: string;
  at: Date;
  messageId?: string;
}

/**
 * Кадр с камеры прямо в переписку: посмотреть, кто у подъезда, это проверка
 * состояния, и для неё приложение не нужно. @throws {DomainError}
 */
export const sendSnapshot = async (
  deps: AppDeps,
  resident: Resident,
  deviceId: string,
): Promise<SentSnapshot> => {
  const device = await deviceFor(deps, resident, deviceId);
  const snapshot = await viewDevice(deps, resident, deviceId);
  const file = fromDataUrl(snapshot.image);

  if (!file) throw new DomainError('devices_unavailable', 'Камера вернула кадр, который не переслать');

  if (!resident.maxUserId) {
    throw new DomainError('user_unknown', 'Некуда отправить: профиль без учётной записи MAX');
  }

  const notifier = deps.notifier;

  if (!notifier?.sendFile) throw new DomainError('devices_unavailable', 'Отправка файлов не настроена');

  const picture = file.contentType === 'image/png' || file.contentType === 'image/jpeg';

  const messageId = await notifier.sendFile({
    maxUserId: resident.maxUserId,
    as: picture ? 'image' : 'document',
    name: `${device.id}.${picture ? 'png' : 'svg'}`,
    contentType: file.contentType,
    content: file.content,
    encoding: file.encoding,
    text: `${device.title}: кадр на ${formatClock(snapshot.at)}`,
  });

  return { title: device.title, at: snapshot.at, ...(messageId ? { messageId } : {}) };
};

/** Открыть дверь гостевым кодом: запрос приходит от панели домофона. @throws {DomainError} */
export const openByCode = async (deps: AppDeps, code: string): Promise<void> => {
  if (!deps.hub) throw new DomainError('devices_unavailable', 'Умный дом не подключён');

  const opened = await deps.hub.openWithCode(code.trim());

  if (!opened) throw new DomainError('code_not_valid', 'Код не подходит или уже не действует');

  if (!opened.issuedBy) return;

  const host = await deps.repository.findResident(opened.issuedBy);

  const home = host?.buildingId;

  if (!home) return;

  const device = (await ask(() => hub(deps).list(home))).find((item) => item.id === opened.deviceId);

  await notifyResident(deps.notifier ?? noopNotifier, host, formatGuestEntry(device?.title ?? 'дверь', deps.now()));
};

/** Датчики дома и их связь. Доступно смене. */
export const sensorsFor = async (deps: DeviceDeps, resident: Resident): Promise<Device[]> => {
  const hub = deps.hub;
  const buildingId = resident.buildingId;

  if (!hub || !buildingId || !isCompanyStaff(resident.role)) return [];

  return (await ask(() => hub.list(buildingId))).filter((device) => isSensor(device));
};

/** Коды, которые сейчас на руках у гостей этого жильца. */
export const activeGuestCodes = async (deps: DeviceDeps, resident: Resident): Promise<GuestCode[]> => {
  if (!deps.hub) return [];

  return deps.hub.activeCodes(resident.id);
};

/** Отзыв своего гостевого кода. @throws {DomainError} */
export const revokeGuestCode = async (deps: AppDeps, resident: Resident, code: string): Promise<void> => {
  if (!deps.hub) throw new DomainError('devices_unavailable', 'Умный дом не подключён');

  const own = (await deps.hub.activeCodes(resident.id)).some((issued) => issued.code === code);

  if (!own) throw new DomainError('code_not_found', 'Такого кода у вас нет');

  await deps.hub.revokeCode(code);
  await recordAction(deps, { actor: resident, action: 'guest_code_revoked', subject: code });
};

/** Просмотры одной камеры одним человеком ближе этого окна идут в журнале одной записью. */
export const VIEW_JOURNAL_MINUTES = 5;

/**
 * Журнал без повторов. Домофония пишет каждый кадр, а смене важно, кто
 * смотрел камеру, а не сколько раз обновил экран: серия просмотров одной
 * камеры одним человеком сворачивается в первую запись. Открытия остаются все.
 */
export const collapseViews = (events: readonly DeviceEvent[], minutes = VIEW_JOURNAL_MINUTES): DeviceEvent[] => {
  const lastShown = new Map<string, number>();
  const window = minutes * 60_000;
  const kept = new Set<DeviceEvent>();

  for (const event of [...events].sort((left, right) => left.at.getTime() - right.at.getTime())) {
    if (event.action !== 'snapshot') {
      kept.add(event);
      continue;
    }

    const key = `${event.deviceId}:${event.residentId ?? ''}`;
    const previous = lastShown.get(key);

    if (previous !== undefined && event.at.getTime() - previous < window) continue;

    lastShown.set(key, event.at.getTime());
    kept.add(event);
  }

  return events.filter((event) => kept.has(event));
};

/** Журнал открытий: кто и когда открывал двери дома и смотрел камеры. */
export const journalFor = async (deps: DeviceDeps, resident: Resident): Promise<DeviceEvent[]> => {
  if (!deps.hub || !resident.buildingId) return [];

  if (!isCompanyStaff(resident.role)) return [];

  return collapseViews(await deps.hub.journal(resident.buildingId));
};

/** @throws {DomainError} */
export const inviteGuest = async (deps: DeviceDeps, resident: Resident, deviceId: string): Promise<GuestCode> => {
  const device = await deviceFor(deps, resident, deviceId);

  if (device.kind === 'camera') {
    throw new DomainError('device_not_openable', 'Камера гостей не пускает');
  }

  return ask(() => hub(deps).issueGuestCode(device.id, GUEST_CODE_MINUTES, resident.id));
};
