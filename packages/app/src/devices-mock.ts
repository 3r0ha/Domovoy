import type { Device, DeviceEvent, DeviceHub, GuestCode, Snapshot } from './devices.js';

/** Заглушка вместо домофонии подрядчика: тот же порт и журнал открытий. */
export interface MockHubOptions {
  /** Готовым списком либо правилом по дому, если набор у домов одинаковый. */
  devices: Device[] | ((buildingId: string) => Device[]);
  now: () => Date;
  createCode?: () => string;
  /** Записи журнала, которые были до запуска. */
  history?: DeviceEvent[];
  /** Когда оборудование выходило на связь до запуска, по идентификаторам. */
  lastSeen?: Record<string, Date>;
}

export interface MockHub extends DeviceHub {
  /** Что происходило с устройствами. */
  readonly events: DeviceEvent[];
  /** Выданные гостевые коды: по ним проверяется, что код одноразовый. */
  readonly codes: GuestCode[];
}

const sixDigits = (): string => `${Math.floor(100_000 + Math.random() * 900_000)}`;

/** Кадр рисуется сам: выдавать чужую фотографию подъезда за эфир нечестно. */
const drawFrame = (title: string): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="#20232b"/>
    <circle cx="320" cy="150" r="46" fill="none" stroke="#4b5163" stroke-width="6"/>
    <circle cx="320" cy="150" r="16" fill="#4b5163"/>
    <text x="320" y="252" fill="#8b93a7" font-family="system-ui, sans-serif" font-size="22"
      text-anchor="middle">${title}</text>
    <text x="320" y="292" fill="#5d6478" font-family="system-ui, sans-serif" font-size="14"
      text-anchor="middle">камера подключается через порт умного дома</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const createMockHub = (options: MockHubOptions): MockHub => {
  const events: DeviceEvent[] = [...(options.history ?? [])];
  const codes: GuestCode[] = [];
  const used = new Set<string>();
  const createCode = options.createCode ?? sixDigits;

  const known = new Map<string, Device>();

  const seen = new Map<string, Date>();

  const all = (buildingId: string): Device[] => {
    const devices =
      typeof options.devices === 'function'
        ? options.devices(buildingId)
        : options.devices.filter((device) => device.buildingId === buildingId);

    for (const device of devices) known.set(device.id, device);

    return devices.map((device) => {
      const at = seen.get(device.id) ?? options.lastSeen?.[device.id];

      return at ? { ...device, lastSeenAt: at } : device;
    });
  };

  return {
    events,
    codes,
    model: true,

    async list(buildingId) {
      return all(buildingId);
    },

    async open(deviceId, by, residentId) {
      const at = options.now();

      seen.set(deviceId, at);
      events.push({ deviceId, at, action: 'opened', by, ...(residentId ? { residentId } : {}) });
    },

    async snapshot(deviceId, residentId): Promise<Snapshot> {
      const at = options.now();

      seen.set(deviceId, at);
      events.push({ deviceId, at, action: 'snapshot', by: 'resident', ...(residentId ? { residentId } : {}) });

      return { deviceId, at, image: drawFrame(known.get(deviceId)?.title ?? 'Камера') };
    },

    async issueGuestCode(deviceId, minutes, residentId): Promise<GuestCode> {
      const at = options.now();
      const code: GuestCode = {
        code: createCode(),
        deviceId,
        expiresAt: new Date(at.getTime() + minutes * 60_000),
        ...(residentId ? { issuedBy: residentId } : {}),
      };

      codes.push(code);
      events.push({ deviceId, at, action: 'guest-code', by: 'resident', ...(residentId ? { residentId } : {}) });

      return code;
    },

    async openWithCode(code) {
      const at = options.now();
      const found = codes.find((issued) => issued.code === code);

      if (!found || used.has(code) || found.expiresAt.getTime() <= at.getTime()) return null;

      used.add(code);
      events.push({
        deviceId: found.deviceId,
        at,
        action: 'opened',
        by: 'guest',
        ...(found.issuedBy ? { residentId: found.issuedBy } : {}),
      });

      return found;
    },

    async activeCodes(residentId) {
      const at = options.now().getTime();

      return codes.filter(
        (issued) => issued.issuedBy === residentId && !used.has(issued.code) && issued.expiresAt.getTime() > at,
      );
    },

    async revokeCode(code) {
      if (used.has(code)) return false;

      used.add(code);

      return codes.some((issued) => issued.code === code);
    },

    async journal(buildingId) {
      const mine = new Set(all(buildingId).map((device) => device.id));

      return events.filter((event) => mine.has(event.deviceId));
    },
  };
};
