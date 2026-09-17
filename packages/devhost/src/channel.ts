/** Канал между стендом и мини-приложением. */
export interface DevHostChannel {
  /** Стенд → приложение. */
  send(message: string): void;
  /** Приложение → стенд. @returns функция отписки. */
  subscribe(listener: (message: string) => void): () => void;
}

export interface IframeChannelOptions {
  /** Целевой origin для сообщений в приложение. По умолчанию '*', как у клиента MAX. */
  targetOrigin?: string;
  /** Ограничение источника входящих сообщений. По умолчанию принимаем только от этого iframe. */
  acceptFrom?: (event: MessageEvent) => boolean;
}

/** Канал поверх iframe: тот же транспорт, что у клиента MAX. */
export const createIframeChannel = (
  iframe: HTMLIFrameElement,
  options: IframeChannelOptions = {},
): DevHostChannel => {
  const listeners = new Set<(message: string) => void>();

  const onMessage = (event: MessageEvent): void => {
    const accept = options.acceptFrom ?? ((candidate: MessageEvent) => candidate.source === iframe.contentWindow);
    if (!accept(event)) return;
    if (typeof event.data !== 'string') return;

    for (const listener of listeners) listener(event.data);
  };

  window.addEventListener('message', onMessage);

  return {
    send(message) {
      iframe.contentWindow?.postMessage(message, options.targetOrigin ?? '*');
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
