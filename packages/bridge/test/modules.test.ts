import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MaxBridgeError } from '../dist/index.js';
import { createMockBridge } from '../dist/mock.js';

const expectError = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof MaxBridgeError, `не MaxBridgeError: ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
};

describe('биометрия', () => {
  it('до инициализации ничего не разрешает', async () => {
    const { bridge } = createMockBridge();
    const biometry = bridge.BiometricManager;

    assert.equal(biometry.isInited, false);

    await expectError(biometry.requestAccess(), 'client.biometry_request_access.not_inited');
    await expectError(biometry.authenticate(), 'client.biometry_request_auth.not_inited');
    await expectError(biometry.updateBiometricToken('токен'), 'client.biometry_update_token.not_inited');
    await expectError(biometry.openSettings(), 'client.biometry_open_settings.not_inited');
  });

  it('после инициализации отдаёт сведения об устройстве', async () => {
    const { bridge } = createMockBridge({ biometry: { available: true, type: ['face'], deviceId: 'iphone' } });

    const info = await bridge.BiometricManager.init();

    assert.equal(info.available, true);
    assert.deepEqual(info.type, ['face']);
    assert.equal(bridge.BiometricManager.deviceId, 'iphone');
    assert.equal(bridge.BiometricManager.isInited, true);
  });

  it('повторная инициализация не ходит к клиенту', async () => {
    const { bridge, client } = createMockBridge();

    await bridge.BiometricManager.init();
    const before = client.log.length;
    await bridge.BiometricManager.init();

    assert.equal(client.log.length, before, 'сведения уже есть, спрашивать нечего');
  });

  it('на устройстве без биометрии отказывает сразу', async () => {
    const { bridge } = createMockBridge({ biometry: { available: false } });
    await bridge.BiometricManager.init();

    await expectError(bridge.BiometricManager.requestAccess(), 'client.biometry_request_access.not_supported');
    await expectError(bridge.BiometricManager.authenticate(), 'client.biometry_request_auth.not_supported');
  });

  it('без разрешения пользователя не аутентифицирует', async () => {
    const { bridge } = createMockBridge();
    await bridge.BiometricManager.init();

    await expectError(bridge.BiometricManager.authenticate(), 'client.biometry_request_auth.permission_denied');
  });

  it('без сохранённого токена не аутентифицирует', async () => {
    const { bridge } = createMockBridge();
    await bridge.BiometricManager.init();
    await bridge.BiometricManager.requestAccess('подтвердите вход');

    assert.equal(bridge.BiometricManager.isAccessGranted, true);
    await expectError(bridge.BiometricManager.authenticate(), 'client.biometry_request_auth.not_found');
  });

  it('полный путь: разрешение, токен, вход', async () => {
    const { bridge } = createMockBridge();
    const biometry = bridge.BiometricManager;

    await biometry.init();
    await biometry.requestAccess();
    const updated = await biometry.updateBiometricToken('секрет');

    assert.equal(updated.status, 'updated');
    assert.equal(biometry.isBiometricTokenSaved, true);

    const auth = await biometry.authenticate('подпишите решение');
    assert.equal(typeof auth.token, 'string');
  });

  it('настройки открываются только когда доступа нет', async () => {
    const { bridge } = createMockBridge();
    await bridge.BiometricManager.init();

    const opened = await bridge.BiometricManager.openSettings();
    assert.equal(opened.status, 'opened');

    await bridge.BiometricManager.requestAccess();
    await expectError(bridge.BiometricManager.openSettings(), 'client.biometry_open_settings.permission_denied');
  });

  it('повторный запрос разрешения не спрашивает пользователя дважды', async () => {
    const { bridge, client } = createMockBridge();
    await bridge.BiometricManager.init();
    await bridge.BiometricManager.requestAccess();

    const before = client.log.length;
    await bridge.BiometricManager.requestAccess();

    assert.equal(client.log.length, before);
  });
});

describe('NFC', () => {
  it('до инициализации ничего не делает', async () => {
    const { bridge } = createMockBridge();

    assert.equal(bridge.NfcManager.isInited, false);
    await expectError(bridge.NfcManager.emulateNfcTag('метка'), 'client.nfc_emulate_nfc_tag.not_inited');
    await expectError(bridge.NfcManager.openSystemSettings(), 'client.nfc_open_system_settings.not_inited');
  });

  it('на устройстве без NFC отказывает', async () => {
    const { bridge } = createMockBridge({ nfc: { available: false } });
    await bridge.NfcManager.init();

    assert.equal(bridge.NfcManager.isAvailable, false);
    await expectError(bridge.NfcManager.emulateNfcTag(), 'client.nfc_emulate_nfc_tag.not_supported');
  });

  it('при выключенном модуле предлагает открыть настройки', async () => {
    const { bridge } = createMockBridge({ nfc: { available: true, enabled: false } });
    await bridge.NfcManager.init();

    await expectError(bridge.NfcManager.emulateNfcTag(), 'client.nfc_emulate_nfc_tag.not_enabled');

    const opened = await bridge.NfcManager.openSystemSettings();
    assert.equal(opened.status, 'opened');
  });

  it('при включённом модуле настройки не открываются', async () => {
    const { bridge } = createMockBridge({ nfc: { available: true, enabled: true } });
    await bridge.NfcManager.init();

    await expectError(bridge.NfcManager.openSystemSettings(), 'client.nfc_open_system_settings.permission_denied');
  });

  it('отозванный доступ не даёт эмулировать метку', async () => {
    const { bridge } = createMockBridge({ nfc: { available: true, enabled: true, accessRevoked: true } });
    await bridge.NfcManager.init();

    await expectError(bridge.NfcManager.emulateNfcTag('метка'), 'client.nfc_emulate_nfc_tag.access_revoked');
  });

  it('исправный модуль эмулирует метку', async () => {
    const { bridge, client } = createMockBridge();
    await bridge.NfcManager.init();

    await bridge.NfcManager.emulateNfcTag('пропуск');

    const sent = client.log.find((entry) => entry.type === 'WebAppNfcEmulateNfcTag' && entry.direction === 'out');
    assert.equal(sent?.payload['nfctag'], 'пропуск');
  });
});

describe('тактильная отдача', () => {
  it('отправляет события клиенту', async () => {
    const { bridge, client } = createMockBridge();

    bridge.HapticFeedback.impactOccurred('heavy');
    bridge.HapticFeedback.notificationOccurred('success');
    bridge.HapticFeedback.selectionChanged();

    await new Promise((resolve) => setTimeout(resolve, 5));

    const types = client.log.filter((entry) => entry.direction === 'out').map((entry) => entry.type);
    assert.deepEqual(types, [
      'WebAppHapticFeedbackImpact',
      'WebAppHapticFeedbackNotification',
      'WebAppHapticFeedbackSelectionChange',
    ]);
  });

  it('не роняет приложение, если платформа не поддерживает вибрацию', async () => {
    const { bridge } = createMockBridge({
      handlers: {
        WebAppHapticFeedbackImpact: () => {
          throw { code: 'client.haptic_feedback_impact.not_supported' };
        },
      },
    });

    assert.doesNotThrow(() => bridge.HapticFeedback.impactOccurred('light'));
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
});

describe('снимок экрана и свайпы', () => {
  it('запрет и разрешение снимка экрана меняют состояние клиента', async () => {
    const { bridge, client } = createMockBridge();

    await bridge.ScreenCapture.disableScreenCapture();
    assert.equal(client.state.screenCaptureEnabled, false);
    assert.equal(bridge.ScreenCapture.isScreenCaptureEnabled, false);

    await bridge.ScreenCapture.enableScreenCapture();
    assert.equal(client.state.screenCaptureEnabled, true);
    assert.equal(bridge.ScreenCapture.isScreenCaptureEnabled, true);
  });

  it('вертикальные свайпы выключаются и включаются', async () => {
    const { bridge, client } = createMockBridge();

    assert.equal(bridge.isVerticalSwipesEnabled, true);

    await bridge.disableVerticalSwipes();
    assert.equal(bridge.isVerticalSwipesEnabled, false);
    assert.equal(client.state.verticalSwipesEnabled, false);

    await bridge.enableVerticalSwipes();
    assert.equal(bridge.isVerticalSwipesEnabled, true);
  });

  it('яркость поднимается и возвращается', async () => {
    const { bridge, client } = createMockBridge();

    await bridge.requestScreenMaxBrightness();
    assert.equal(client.state.maxBrightness, true);

    await bridge.restoreScreenBrightness();
    assert.equal(client.state.maxBrightness, false);
  });
});

describe('прочие возможности клиента', () => {
  it('запрашивает телефон', async () => {
    const { bridge } = createMockBridge({ phone: '79995554433' });

    const contact = await bridge.requestContact();

    assert.equal(contact.phone, '79995554433');
    assert.equal(typeof contact.authDate, 'string');
    assert.equal(typeof contact.hash, 'string');
  });

  it('читает код и отдаёт результат', async () => {
    const { bridge } = createMockBridge({ codeReaderResult: 'https://max.ru/uk_bot?startapp=lift_7' });

    const result = await bridge.openCodeReader();

    assert.equal(result.code, 'https://max.ru/uk_bot?startapp=lift_7');
  });

  it('сообщает точку входа', async () => {
    const { bridge } = createMockBridge({ entryPoint: 'tabbar' });

    assert.equal((await bridge.getLaunchContext()).entryPoint, 'tabbar');
  });

  it('скачивание файла уходит клиенту', async () => {
    const { bridge, client } = createMockBridge();

    await bridge.downloadFile('https://example.test/акт.pdf', 'акт.pdf');

    const sent = client.log.find((entry) => entry.type === 'WebAppDownloadFile' && entry.direction === 'out');
    assert.equal(sent?.payload['file_name'], 'акт.pdf');
  });

  it('шеринг текста уходит клиенту', async () => {
    const { bridge, client } = createMockBridge();

    await bridge.shareContent({ text: 'Заявка №42 принята' });

    const sent = client.log.find((entry) => entry.type === 'WebAppShare' && entry.direction === 'out');
    assert.equal(sent?.payload['text'], 'Заявка №42 принята');
  });

  it('подтверждение закрытия включается и выключается', () => {
    const { bridge, client } = createMockBridge();

    bridge.enableClosingConfirmation();
    assert.equal(client.state.closingConfirmation, true);

    bridge.disableClosingConfirmation();
    assert.equal(client.state.closingConfirmation, false);
  });

  it('закрытие приложения доходит до клиента', () => {
    const { bridge, client } = createMockBridge();

    bridge.close();

    assert.equal(client.state.closed, true);
  });

  it('открытие ссылок фиксируется', () => {
    const { bridge, client } = createMockBridge();

    bridge.openLink('https://example.test/help');
    bridge.openMaxLink('https://max.ru/uk_bot');

    assert.deepEqual(client.state.openedLinks, ['https://example.test/help', 'https://max.ru/uk_bot']);
  });
});
