import { MaxBridgeError } from '../errors.js';
import type { RequestFn } from '../request-controller.js';
import type { NfcInfo } from '../types.js';

/** Эмуляция NFC-метки (только Android). */
export class NfcManager {
  private info: NfcInfo = { available: false, enabled: false, accessRevoked: false };
  private inited = false;

  constructor(private readonly request: RequestFn) {}

  get isInited(): boolean {
    return this.inited;
  }

  get isAvailable(): boolean {
    return this.info.available;
  }

  get isEnabled(): boolean {
    return this.info.enabled;
  }

  async init(): Promise<NfcInfo> {
    this.info = { ...this.info, ...(await this.request('WebAppNfcGetInfo')) };
    this.inited = true;
    return { ...this.info };
  }

  async emulateNfcTag(nfctag?: string): Promise<void> {
    this.assertInited('client.nfc_emulate_nfc_tag.not_inited');
    this.assert(this.info.available, 'client.nfc_emulate_nfc_tag.not_supported', 'NFC недоступен на устройстве');
    this.assert(this.info.enabled, 'client.nfc_emulate_nfc_tag.not_enabled', 'NFC выключен в настройках системы');
    this.assert(
      !this.info.accessRevoked,
      'client.nfc_emulate_nfc_tag.access_revoked',
      'Пользователь отозвал доступ к NFC',
    );

    await this.request('WebAppNfcEmulateNfcTag', { nfctag });
  }

  async openSystemSettings(): Promise<{ status: 'opened' }> {
    this.assertInited('client.nfc_open_system_settings.not_inited');
    this.assert(this.info.available, 'client.nfc_open_system_settings.not_supported', 'NFC недоступен на устройстве');
    this.assert(
      !this.info.enabled,
      'client.nfc_open_system_settings.permission_denied',
      'NFC уже включён, открывать настройки не нужно',
    );

    return this.request('WebAppNfcOpenSystemSettings');
  }

  private assertInited(code: string): void {
    this.assert(this.inited, code, 'NfcManager не инициализирован: вызовите init()');
  }

  private assert(condition: boolean, code: string, message: string): void {
    if (!condition) throw new MaxBridgeError(code, message);
  }
}
