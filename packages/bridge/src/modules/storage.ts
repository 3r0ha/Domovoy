import type { RequestEvent } from '../events.js';
import type { RequestFn } from '../request-controller.js';

interface StorageEvents {
  save: Extract<RequestEvent, 'WebAppDeviceStorageSaveKey' | 'WebAppSecureStorageSaveKey'>;
  get: Extract<RequestEvent, 'WebAppDeviceStorageGetKey' | 'WebAppSecureStorageGetKey'>;
  clear: Extract<RequestEvent, 'WebAppDeviceStorageClear' | 'WebAppSecureStorageClear'>;
}

const DEVICE_EVENTS: StorageEvents = {
  save: 'WebAppDeviceStorageSaveKey',
  get: 'WebAppDeviceStorageGetKey',
  clear: 'WebAppDeviceStorageClear',
};

const SECURE_EVENTS: StorageEvents = {
  save: 'WebAppSecureStorageSaveKey',
  get: 'WebAppSecureStorageGetKey',
  clear: 'WebAppSecureStorageClear',
};

/** Хранилище на стороне клиента MAX. */
export class BridgeStorage {
  constructor(
    private readonly request: RequestFn,
    private readonly events: StorageEvents,
  ) {}

  async setItem(key: string, value: string): Promise<void> {
    await this.request(this.events.save, { key, value });
  }

  async getItem(key: string): Promise<string | null> {
    const result = await this.request(this.events.get, { key });
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return result?.value ?? null;
  }

  async removeItem(key: string): Promise<void> {
    await this.request(this.events.save, { key, value: null });
  }

  async clear(): Promise<void> {
    await this.request(this.events.clear);
  }
}

export const createDeviceStorage = (request: RequestFn): BridgeStorage => new BridgeStorage(request, DEVICE_EVENTS);

/** Шифрованное хранилище клиента: не больше 10 ключей на бота. */
export const createSecureStorage = (request: RequestFn): BridgeStorage => new BridgeStorage(request, SECURE_EVENTS);
