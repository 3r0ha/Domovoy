export type BridgeMessageHandler = (type: string, payload: Record<string, unknown>) => void;

export interface BridgeTransport {
  readonly kind: 'iframe' | 'webview' | 'mock' | 'none';
  send(type: string, payload: Record<string, unknown>): void;
  subscribe(handler: BridgeMessageHandler): () => void;
  /** Освобождает ресурсы транспорта: слушатели окна, глобальные хуки. */
  destroy?(): void;
}

/** Клиент MAX и его тестовые стенды. */
export const MAX_ORIGIN_PATTERN = /^https:\/\/.*\.(?:max|oneme)\.ru$/;

/** Локальные origin для dev-стенда. */
export const LOCAL_DEV_ORIGINS: readonly RegExp[] = [
  /^https?:\/\/localhost(?::\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https?:\/\/\[::1\](?::\d+)?$/,
];

/** Часть Window, которая нужна транспорту. */
export interface WindowLike {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  parent: { postMessage(message: string, targetOrigin: string): void };
}

/** Мост в нативный клиент: его выставляет WebView, когда открывает мини-приложение. */
export interface WebViewHandler {
  postEvent(type: string, payload: string): void;
}

/** Точка входа, через которую нативный клиент доставляет события в приложение. */
export interface WebAppReceiver {
  sendEvent(type: string, payload?: string): void;
}

export interface WebViewGlobal {
  WebViewHandler?: WebViewHandler;
  WebApp?: Partial<WebAppReceiver> & Record<string, unknown>;
}

declare global {
  interface Window {
    WebViewHandler?: WebViewHandler;
    WebApp?: Partial<WebAppReceiver> & Record<string, unknown>;
  }
}

export interface IframeTransportOptions {
  /** Дополнительные origin, которым доверяем (dev-эмулятор, локальный стенд). */
  trustedOrigins?: (string | RegExp)[];
  /** Целевой origin для исходящих сообщений. Клиент MAX использует '*'. */
  targetOrigin?: string;
  /** Окно-хозяин. Подменяется в тестах. */
  window?: WindowLike;
}

const matchesOrigin = (origin: string, extra: (string | RegExp)[] = []): boolean =>
  MAX_ORIGIN_PATTERN.test(origin) ||
  extra.some((rule) => (typeof rule === 'string' ? rule === origin : rule.test(origin)));

/** Транспорт для запуска в iframe (веб-клиент MAX и dev-стенд). */
export const createIframeTransport = (options: IframeTransportOptions = {}): BridgeTransport => {
  const host = options.window ?? (globalThis as unknown as { window: WindowLike }).window;
  const handlers = new Set<BridgeMessageHandler>();

  const onMessage = (event: MessageEvent): void => {
    if (!matchesOrigin(event.origin, options.trustedOrigins)) return;
    if (typeof event.data !== 'string') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) return;
    const { type, ...payload } = parsed as { type?: unknown } & Record<string, unknown>;
    if (typeof type !== 'string' || !type.startsWith('WebApp')) return;

    for (const handler of [...handlers]) handler(type, payload);
  };

  host.addEventListener('message', onMessage);

  return {
    kind: 'iframe',
    send(type, payload) {
      host.parent.postMessage(JSON.stringify({ type, ...payload }), options.targetOrigin ?? '*');
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    destroy() {
      host.removeEventListener('message', onMessage);
      handlers.clear();
    },
  };
};

/** Транспорт для нативных клиентов iOS и Android. */
export const createWebViewTransport = (
  handler: WebViewHandler,
  target: WebViewGlobal = globalThis as unknown as WebViewGlobal,
): BridgeTransport => {
  const handlers = new Set<BridgeMessageHandler>();
  const previous = target.WebApp;
  const previousSendEvent = typeof previous?.sendEvent === 'function' ? previous.sendEvent.bind(previous) : null;

  const receive: WebAppReceiver['sendEvent'] = (type, payload = '{}') => {
    previousSendEvent?.(type, payload);

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      console.warn('[maxkit] Не удалось разобрать payload события', type);
      return;
    }

    const data = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    for (const listener of [...handlers]) listener(type, data);
  };

  target.WebApp = previous ? Object.assign(previous, { sendEvent: receive }) : { sendEvent: receive };

  return {
    kind: 'webview',
    send(type, payload) {
      handler.postEvent(type, JSON.stringify(payload));
    },
    subscribe(listener) {
      handlers.add(listener);
      return () => handlers.delete(listener);
    },
    destroy() {
      handlers.clear();
      if (previous) Object.assign(previous, { sendEvent: previousSendEvent ?? undefined });
      else delete target.WebApp;
    },
  };
};

/** Транспорт-заглушка: приложение в обычном браузере не падает, а только предупреждает. */
export const createNoopTransport = (onSend?: (type: string) => void): BridgeTransport => ({
  kind: 'none',
  send(type) {
    onSend?.(type);
    console.warn('[maxkit] Событие не отправлено, приложение открыто вне MAX:', type);
  },
  subscribe() {
    return () => undefined;
  },
});

export const detectTransport = (options: IframeTransportOptions = {}): BridgeTransport => {
  if (typeof window === 'undefined') return createNoopTransport();
  if (window.self !== window.top) return createIframeTransport(options);
  if (window.WebViewHandler) return createWebViewTransport(window.WebViewHandler);
  return createNoopTransport();
};
