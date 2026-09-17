import { MaxBridgeError } from '../errors.js';
import type { RequestFn } from '../request-controller.js';
import type { BiometricType, BiometryInfo } from '../types.js';

const EMPTY_INFO: BiometryInfo = {
  available: false,
  accessRequested: false,
  accessGranted: false,
  type: ['unknown'],
  tokenSaved: false,
  deviceId: null,
};

/** Биометрия клиента MAX. */
export class BiometricManager {
  private info: BiometryInfo = { ...EMPTY_INFO };
  private inited = false;

  constructor(private readonly request: RequestFn) {}

  get isInited(): boolean {
    return this.inited;
  }

  get isBiometricAvailable(): boolean {
    return this.info.available;
  }

  get isAccessRequested(): boolean {
    return this.info.accessRequested;
  }

  get isAccessGranted(): boolean {
    return this.info.accessGranted;
  }

  get isBiometricTokenSaved(): boolean {
    return this.info.tokenSaved;
  }

  get biometricType(): BiometricType[] {
    return [...this.info.type];
  }

  get deviceId(): string | null {
    return this.info.deviceId;
  }

  async init(): Promise<BiometryInfo> {
    if (this.inited) return { ...this.info };
    this.merge(await this.request('WebAppBiometryGetInfo'));
    this.inited = true;
    return { ...this.info };
  }

  async requestAccess(reason?: string): Promise<BiometryInfo> {
    if (this.info.accessRequested) return { ...this.info };
    this.assertInited('client.biometry_request_access.not_inited');
    this.assertAvailable('client.biometry_request_access.not_supported');
    this.merge(await this.request('WebAppBiometryRequestAccess', { reason }));
    return { ...this.info };
  }

  async authenticate(reason?: string): Promise<{ token?: string }> {
    this.assertInited('client.biometry_request_auth.not_inited');
    this.assertAvailable('client.biometry_request_auth.not_supported');
    this.assertAccessGranted('client.biometry_request_auth.permission_denied');

    if (!this.info.tokenSaved) {
      throw new MaxBridgeError('client.biometry_request_auth.not_found', 'Биометрический токен не найден');
    }

    return this.request('WebAppBiometryRequestAuth', { reason });
  }

  async updateBiometricToken(token?: string, reason?: string): Promise<{ status: string }> {
    this.assertInited('client.biometry_update_token.not_inited');
    this.assertAvailable('client.biometry_update_token.not_supported');
    this.assertAccessGranted('client.biometry_update_token.permission_denied');

    const result = await this.request('WebAppBiometryUpdateToken', { token, reason });
    this.info.tokenSaved = result.status === 'updated';
    return result;
  }

  async openSettings(): Promise<{ status: 'opened' }> {
    this.assertInited('client.biometry_open_settings.not_inited');
    this.assertAvailable('client.biometry_open_settings.not_supported');

    if (this.info.accessGranted) {
      throw new MaxBridgeError(
        'client.biometry_open_settings.permission_denied',
        'Доступ уже предоставлен, открывать настройки не нужно',
      );
    }

    return this.request('WebAppBiometryOpenSettings');
  }

  private merge(patch: Partial<BiometryInfo>): void {
    this.info = { ...this.info, ...patch };
  }

  private assertInited(code: string): void {
    if (!this.inited) throw new MaxBridgeError(code, 'BiometricManager не инициализирован: вызовите init()');
  }

  private assertAvailable(code: string): void {
    if (!this.info.available) throw new MaxBridgeError(code, 'Биометрия недоступна на этом устройстве');
  }

  private assertAccessGranted(code: string): void {
    if (!this.info.accessGranted) throw new MaxBridgeError(code, 'Пользователь не дал доступ к биометрии');
  }
}
