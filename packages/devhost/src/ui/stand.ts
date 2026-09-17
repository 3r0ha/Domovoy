import { createIframeChannel } from '../channel.js';
import { DevHost, type DevHostOptions } from '../dev-host.js';

import { createDevHostPanel, type Panel } from './panel.js';

export interface StandOptions extends DevHostOptions {
  /** Куда встроить стенд. */
  container: HTMLElement;
  /** Размеры окна приложения. */
  viewport?: { width: number; height: number };
}

export interface Stand {
  host: DevHost;
  panel: Panel;
  iframe: HTMLIFrameElement;
  /** Перезапускает приложение с теми же параметрами запуска. */
  reload(): void;
  destroy(): void;
}

/** Собирает стенд целиком: рамка с приложением слева, панель управления справа. */
export const createStand = async ({ container, viewport, ...options }: StandOptions): Promise<Stand> => {
  const host = await DevHost.create(options);

  const layout = document.createElement('div');
  layout.style.cssText = 'display:flex;gap:16px;align-items:flex-start;padding:16px;background:#f3f4f6;min-height:100vh';

  const frame = document.createElement('div');
  frame.style.cssText = 'background:#111827;border-radius:24px;padding:10px;flex:none';

  const iframe = document.createElement('iframe');
  iframe.width = String(viewport?.width ?? 390);
  iframe.height = String(viewport?.height ?? 844);
  iframe.style.cssText = 'border:0;border-radius:16px;background:#fff;display:block';
  iframe.src = host.appUrl;

  const panelContainer = document.createElement('div');
  panelContainer.style.cssText = 'flex:1;min-width:320px;max-width:640px';

  frame.append(iframe);
  layout.append(frame, panelContainer);
  container.append(layout);

  const detach = host.attach(createIframeChannel(iframe));

  const reload = (): void => {
    iframe.src = host.appUrl;
  };

  const panel = createDevHostPanel({ container: panelContainer, host, onReload: reload });

  return {
    host,
    panel,
    iframe,
    reload,
    destroy: () => {
      panel.destroy();
      detach();
      layout.remove();
    },
  };
};
