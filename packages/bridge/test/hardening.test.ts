import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MaxBridgeError,
  buildLaunchHash,
  compareVersions,
  createBridge,
  getBridge,
  isVersionAtLeast,
  parseInitData,
  readLaunchParams,
  resetBridge,
  supportsFeature,
} from '../dist/index.js';
import { createMockBridge, createMockLaunchParams } from '../dist/mock.js';

/** Минимальный Storage: sessionStorage в Node отсутствует. */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

describe('чтение параметров запуска', () => {
  const launchParams = createMockLaunchParams({ startParam: 'request_7' });
  const hash = buildLaunchHash(launchParams);

  it('разбирает hash, каким его отдаёт клиент MAX', () => {
    const parsed = readLaunchParams({ hash, storage: null });

    assert.equal(parsed.initData, launchParams.initData);
    assert.equal(parsed.platform, 'web');
    assert.equal(parsed.version, '25.9.16');
    assert.equal(parsed.initDataUnsafe.start_param, 'request_7');
  });

  it('переживает потерю hash: значения берутся из хранилища', () => {
    const storage = new MemoryStorage();

    readLaunchParams({ hash, storage });
    const afterRouting = readLaunchParams({ hash: '', storage });

    assert.equal(afterRouting.initData, launchParams.initData, 'initData восстановлен из sessionStorage');
    assert.equal(afterRouting.platform, 'web');
  });

  it('достаёт параметры из полного URL запуска', () => {
    const parsed = readLaunchParams({ hash: '', url: `https://app.example.ru/requests${hash}`, storage: null });

    assert.equal(parsed.initData, launchParams.initData);
  });

  it('отбрасывает неизвестную платформу', () => {
    const parsed = readLaunchParams({ hash: '#WebAppPlatform=nokia3310', storage: null });

    assert.equal(parsed.platform, null);
    assert.equal(parsed.initData, null);
  });

  it('buildLaunchHash и readLaunchParams обратны друг другу', () => {
    const restored = readLaunchParams({ hash: buildLaunchHash(launchParams), storage: null });

    assert.deepEqual(restored.initDataUnsafe, parseInitData(launchParams.initData));
    assert.equal(restored.deviceName, launchParams.deviceName);
  });
});

describe('поведение вне клиента MAX', () => {
  it('сразу отклоняет запрос, а не ждёт таймаут', async () => {
    const bridge = createBridge({ launchParams: createMockLaunchParams() });
    assert.equal(bridge.isInsideMax, false);

    const started = Date.now();
    const error = await bridge.getViewportSize().then(
      () => null,
      (reason: unknown) => reason,
    );

    assert.ok(error instanceof MaxBridgeError);
    assert.equal(error.code, 'client.get_viewport_size.not_available');
    assert.equal(error.isOutsideMax, true);
    assert.ok(Date.now() - started < 1000, 'отказ приходит мгновенно, а не через 10 секунд');
  });

  it('режим ожидания включается явно', async () => {
    const bridge = createBridge({ failFastOutsideMax: false, launchParams: createMockLaunchParams() });

    const error = await bridge.request('WebAppGetViewportSize', {}, { timeout: 20 }).then(
      () => null,
      (reason: unknown) => reason,
    );

    assert.ok(error instanceof MaxBridgeError);
    assert.equal(error.isTimeout, true);
  });
});

describe('отмена запросов', () => {
  it('отклоняет запрос по AbortSignal и освобождает очередь', async () => {
    const { bridge } = createMockBridge({
      handlers: { WebAppOpenCodeReader: () => new Promise(() => undefined) },
    });
    const controller = new AbortController();

    const promise = bridge.request('WebAppOpenCodeReader', { fileSelect: true }, { signal: controller.signal });
    assert.equal(bridge.pendingRequests, 1);

    controller.abort();
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );

    assert.ok(error instanceof MaxBridgeError);
    assert.equal(error.isAborted, true);
    assert.equal(bridge.pendingRequests, 0, 'отменённый запрос не висит в очереди');
  });

  it('не отправляет запрос, если сигнал уже отменён', async () => {
    const { bridge, client } = createMockBridge();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      bridge.getViewportSize({ signal: controller.signal }),
      (error: unknown) => error instanceof MaxBridgeError && error.isAborted,
    );

    assert.equal(
      client.log.some((entry) => entry.type === 'WebAppGetViewportSize'),
      false,
      'событие не ушло в транспорт',
    );
  });
});

describe('неудачная отправка', () => {
  it('не оставляет запрос висеть до таймаута', async () => {
    const bridge = createBridge({
      transport: {
        kind: 'mock',
        send: () => {
          throw new TypeError('не сериализуется');
        },
        subscribe: () => () => undefined,
      },
      launchParams: { initData: null, initDataUnsafe: {}, platform: 'web', version: null, deviceName: null },
    });

    const error = await bridge.getViewportSize().then(
      () => null,
      (reason: unknown) => reason,
    );

    assert.ok(error instanceof MaxBridgeError);
    assert.match(error.code, /send_failed$/);
    assert.ok(error.raw instanceof TypeError, 'исходная причина сохранена');
    assert.equal(bridge.pendingRequests, 0, 'очередь не держит неотправленный запрос');
  });
});

describe('уничтожение моста', () => {
  it('отклоняет незавершённые запросы и блокирует новые', async () => {
    const { bridge } = createMockBridge({
      handlers: { WebAppGetViewportSize: () => new Promise(() => undefined) },
    });

    const pending = bridge.getViewportSize();
    bridge.destroy();

    await assert.rejects(pending, (error: unknown) => error instanceof MaxBridgeError && error.code === 'client.bridge.destroyed');
    await assert.rejects(bridge.getViewportSize(), (error: unknown) => error instanceof MaxBridgeError);
    assert.equal(bridge.isDestroyed, true);
  });

  it('повторный destroy безопасен', () => {
    const { bridge } = createMockBridge();

    bridge.destroy();
    assert.doesNotThrow(() => bridge.destroy());
  });

  it('после destroy события клиента больше не доходят', () => {
    const { bridge, client } = createMockBridge();
    let calls = 0;

    bridge.on('WebAppBackButtonPressed', () => {
      calls += 1;
    });

    client.pressBackButton();
    bridge.destroy();
    client.pressBackButton();

    assert.equal(calls, 1);
  });
});

describe('возможности платформы', () => {
  it('NFC доступен только на Android', () => {
    assert.equal(supportsFeature('nfc', { platform: 'android', version: '25.9.16' }), true);
    assert.equal(supportsFeature('nfc', { platform: 'ios', version: '25.9.16' }), false);
    assert.equal(supportsFeature('nfc', { platform: 'desktop', version: '25.9.16' }), false);
  });

  it('биометрия и вибрация, мобильные возможности', () => {
    assert.equal(supportsFeature('biometry', { platform: 'ios', version: null }), true);
    assert.equal(supportsFeature('haptics', { platform: 'web', version: null }), false);
  });

  it('неизвестная платформа не прячет функциональность', () => {
    assert.equal(supportsFeature('nfc', { platform: null, version: null }), true);
  });

  it('мост отвечает за свою платформу', () => {
    const { bridge } = createMockBridge({ platform: 'android' });

    assert.equal(bridge.supports('nfc'), true);
    assert.equal(bridge.supports('haptics'), true);
  });

  it('сравнение версий работает на разной длине', () => {
    assert.equal(compareVersions('25.9.16', '25.9.16'), 0);
    assert.equal(compareVersions('25.10.0', '25.9.16'), 1);
    assert.equal(compareVersions('25.9', '25.9.1'), -1);
    assert.equal(isVersionAtLeast(null, '99.0.0'), true, 'неизвестная версия не блокирует функциональность');
    assert.equal(isVersionAtLeast('25.9.16', '26.0.0'), false);
  });
});

describe('подписка на события', () => {
  it('onAny видит события, которых ещё нет в типах', () => {
    const { bridge, client } = createMockBridge();
    const seen: string[] = [];

    bridge.onAny((type) => void seen.push(type));
    client.emit('WebAppSomeFutureEvent', { value: 1 });

    assert.deepEqual(seen, ['WebAppSomeFutureEvent']);
  });

  it('обработчик может отписаться прямо во время вызова', () => {
    const { bridge, client } = createMockBridge();
    let calls = 0;

    const off = bridge.on('WebAppBackButtonPressed', () => {
      calls += 1;
      off();
    });
    bridge.on('WebAppBackButtonPressed', () => {
      calls += 1;
    });

    assert.doesNotThrow(() => client.pressBackButton());
    assert.equal(calls, 2, 'второй обработчик всё равно вызван');

    client.pressBackButton();
    assert.equal(calls, 3, 'отписавшийся больше не вызывается');
  });
});

describe('валидация аргументов', () => {
  it('отклоняет некорректный mid', async () => {
    const { bridge } = createMockBridge();

    await assert.rejects(
      bridge.shareMaxContent({ mid: 'mid.не-хекс', chatType: 'DIALOG' }),
      (error: unknown) => error instanceof MaxBridgeError && error.code === 'client.web_app_max_share.invalid_request',
    );
  });
});

describe('синглтон', () => {
  it('возвращает один и тот же мост и сбрасывается явно', () => {
    resetBridge();

    const first = getBridge({ launchParams: createMockLaunchParams() });
    const second = getBridge();
    assert.equal(first, second);

    resetBridge();
    assert.notEqual(getBridge({ launchParams: createMockLaunchParams() }), first);
    resetBridge();
  });
});
