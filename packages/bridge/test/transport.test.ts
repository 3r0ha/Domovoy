import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOCAL_DEV_ORIGINS,
  MaxBridgeError,
  createBridge,
  createIframeTransport,
  createWebViewTransport,
  methodSlug,
  toBridgeError,
  type WebViewGlobal,
  type WindowLike,
} from '../dist/index.js';
import { createMockBridge } from '../dist/mock.js';

/** Окно-двойник: тест управляет доставкой сообщений и видит отправленные. */
class FakeWindow implements WindowLike {
  readonly sent: { message: string; targetOrigin: string }[] = [];
  readonly parent = {
    postMessage: (message: string, targetOrigin: string) => void this.sent.push({ message, targetOrigin }),
  };

  private readonly listeners = new Set<(event: MessageEvent) => void>();

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Имитирует сообщение из родительского окна. */
  deliver(origin: string, data: unknown): void {
    for (const listener of this.listeners) listener({ origin, data } as MessageEvent);
  }
}

describe('iframe-транспорт', () => {
  const setup = (trustedOrigins?: (string | RegExp)[]) => {
    const host = new FakeWindow();
    const transport = createIframeTransport({ window: host, ...(trustedOrigins ? { trustedOrigins } : {}) });
    const received: { type: string; payload: Record<string, unknown> }[] = [];
    transport.subscribe((type, payload) => void received.push({ type, payload }));
    return { host, transport, received };
  };

  it('отправляет событие родительскому окну в формате протокола', () => {
    const { host, transport } = setup();

    transport.send('WebAppReady', { requestId: 'r-1' });

    assert.equal(host.sent.length, 1);
    assert.deepEqual(JSON.parse(host.sent[0]!.message), { type: 'WebAppReady', requestId: 'r-1' });
    assert.equal(host.sent[0]!.targetOrigin, '*');
  });

  it('принимает сообщения только с origin клиента MAX', () => {
    const { host, received } = setup();

    host.deliver('https://web.max.ru', JSON.stringify({ type: 'WebAppBackButtonPressed' }));
    host.deliver('https://test.oneme.ru', JSON.stringify({ type: 'WebAppBackButtonPressed' }));
    host.deliver('https://evil.example.com', JSON.stringify({ type: 'WebAppBackButtonPressed' }));
    host.deliver('http://web.max.ru', JSON.stringify({ type: 'WebAppBackButtonPressed' }));

    assert.equal(received.length, 2, 'чужой origin и http отбрасываются');
  });

  it('доверяет localhost только по явному разрешению', () => {
    const strict = setup();
    strict.host.deliver('http://localhost:5174', JSON.stringify({ type: 'WebAppBackButtonPressed' }));
    assert.equal(strict.received.length, 0);

    const dev = setup([...LOCAL_DEV_ORIGINS]);
    dev.host.deliver('http://localhost:5174', JSON.stringify({ type: 'WebAppBackButtonPressed' }));
    assert.equal(dev.received.length, 1);
  });

  it('игнорирует мусор вместо сообщений протокола', () => {
    const { host, received } = setup();

    host.deliver('https://web.max.ru', { type: 'WebAppBackButtonPressed' });
    host.deliver('https://web.max.ru', 'не json');
    host.deliver('https://web.max.ru', JSON.stringify({ type: 'SomethingElse' }));
    host.deliver('https://web.max.ru', JSON.stringify(null));

    assert.equal(received.length, 0);
  });

  it('destroy снимает слушатель окна', () => {
    const { host, transport, received } = setup();
    assert.equal(host.listenerCount, 1);

    transport.destroy?.();
    host.deliver('https://web.max.ru', JSON.stringify({ type: 'WebAppBackButtonPressed' }));

    assert.equal(host.listenerCount, 0);
    assert.equal(received.length, 0);
  });
});

describe('webview-транспорт', () => {
  it('выставляет window.WebApp.sendEvent как точку входа клиента', () => {
    const posted: { type: string; payload: string }[] = [];
    const target: WebViewGlobal = {};
    const transport = createWebViewTransport(
      { postEvent: (type, payload) => void posted.push({ type, payload }) },
      target,
    );

    const received: { type: string; payload: Record<string, unknown> }[] = [];
    transport.subscribe((type, payload) => void received.push({ type, payload }));

    transport.send('WebAppReady', {});
    assert.deepEqual(posted, [{ type: 'WebAppReady', payload: '{}' }]);

    target.WebApp?.sendEvent?.('WebAppBackButtonPressed', '{"foo":1}');
    assert.deepEqual(received, [{ type: 'WebAppBackButtonPressed', payload: { foo: 1 } }]);
  });

  it('не затирает обработчик официального скрипта', () => {
    const originalCalls: string[] = [];
    const target: WebViewGlobal = { WebApp: { sendEvent: (type: string) => void originalCalls.push(type) } };

    const transport = createWebViewTransport({ postEvent: () => undefined }, target);
    const received: string[] = [];
    transport.subscribe((type) => void received.push(type));

    target.WebApp?.sendEvent?.('WebAppBackButtonPressed', '{}');

    assert.deepEqual(originalCalls, ['WebAppBackButtonPressed'], 'исходный обработчик вызван');
    assert.deepEqual(received, ['WebAppBackButtonPressed'], 'наш обработчик тоже');

    transport.destroy?.();
    target.WebApp?.sendEvent?.('WebAppBackButtonPressed', '{}');
    assert.equal(received.length, 1, 'после destroy события больше не приходят');
  });

  it('не падает на битом payload', () => {
    const target: WebViewGlobal = {};
    const transport = createWebViewTransport({ postEvent: () => undefined }, target);
    const received: string[] = [];
    transport.subscribe((type) => void received.push(type));

    assert.doesNotThrow(() => target.WebApp?.sendEvent?.('WebAppBackButtonPressed', '{битый'));
    assert.equal(received.length, 0);
  });
});

describe('нормализация ошибок', () => {
  it('превращает объект клиента в MaxBridgeError', () => {
    const error = toBridgeError({ error: { code: 'client.some_method.not_supported' } });

    assert.ok(error instanceof MaxBridgeError);
    assert.equal(error.isUnsupported, true);
  });

  it('сохраняет исходное значение и подставляет код по умолчанию', () => {
    const error = toBridgeError('строка вместо ошибки', 'client.fallback');

    assert.equal(error.code, 'client.fallback');
    assert.equal(error.raw, 'строка вместо ошибки');
  });

  it('переводит имя события в код метода', () => {
    assert.equal(methodSlug('WebAppOpenCodeReader'), 'open_code_reader');
    assert.equal(methodSlug('WebAppNfcEmulateNfcTag'), 'nfc_emulate_nfc_tag');
    assert.equal(methodSlug('Странное'), 'unknown_method');
  });
});

describe('лимиты хранилища', () => {
  it('шифрованное хранилище упирается в лимит ключей', async () => {
    const { bridge } = createMockBridge({ secureStorageLimit: 2 });

    await bridge.SecureStorage.setItem('a', '1');
    await bridge.SecureStorage.setItem('b', '2');
    await bridge.SecureStorage.setItem('b', '3');

    await assert.rejects(
      bridge.SecureStorage.setItem('c', '4'),
      (error: unknown) =>
        error instanceof MaxBridgeError && error.code === 'client.secure_storage_save_key.limit_exceeded',
    );
  });

  it('обычное хранилище лимитом не ограничено', async () => {
    const { bridge } = createMockBridge({ secureStorageLimit: 1 });

    await bridge.DeviceStorage.setItem('a', '1');
    await bridge.DeviceStorage.setItem('b', '2');

    assert.equal(await bridge.DeviceStorage.getItem('b'), '2');
  });
});

describe('транспорт по умолчанию вне браузера', () => {
  it('в Node мост создаётся без падения и знает, что он вне MAX', () => {
    const bridge = createBridge();

    assert.equal(bridge.transportKind, 'none');
    assert.equal(bridge.isInsideMax, false);
    bridge.destroy();
  });
});
