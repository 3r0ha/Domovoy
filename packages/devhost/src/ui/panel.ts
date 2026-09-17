import type { DevHost } from '../dev-host.js';

export interface PanelOptions {
  container: HTMLElement;
  host: DevHost;
  /** Перезагрузить приложение: обычно перезапись src у iframe. */
  onReload?: () => void;
  /** Как часто обновлять панель. `0` отключает автообновление. */
  autoRefreshMs?: number;
  /** Сколько последних событий показывать. */
  logLimit?: number;
}

export interface Panel {
  /** Перерисовать содержимое по текущему состоянию эмулятора. */
  update(): void;
  destroy(): void;
}

const STYLES = `
.maxkit-panel { font: 13px/1.45 -apple-system, Segoe UI, Roboto, sans-serif; color: #1f2937; display: flex; flex-direction: column; gap: 12px; }
.maxkit-panel h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; margin: 0 0 6px; }
.maxkit-panel section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; }
.maxkit-panel button { font: inherit; padding: 5px 10px; border: 1px solid #d1d5db; border-radius: 6px; background: #f9fafb; cursor: pointer; }
.maxkit-panel button:hover { background: #f3f4f6; }
.maxkit-panel .maxkit-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.maxkit-panel dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; }
.maxkit-panel dt { color: #6b7280; }
.maxkit-panel dd { margin: 0; font-variant-numeric: tabular-nums; }
.maxkit-panel .maxkit-log { max-height: 260px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.maxkit-panel .maxkit-log div { padding: 2px 0; border-bottom: 1px solid #f3f4f6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.maxkit-panel .maxkit-out { color: #1d4ed8; }
.maxkit-panel .maxkit-in { color: #047857; }
.maxkit-panel .maxkit-empty { color: #9ca3af; }
`;

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const definitions = (entries: [string, string][]): HTMLElement => {
  const list = element('dl');

  for (const [term, value] of entries) {
    list.append(element('dt', undefined, term), element('dd', undefined, value));
  }

  return list;
};

const storageTable = (title: string, storage: Map<string, string>): HTMLElement => {
  const section = element('section');
  section.append(element('h2', undefined, title));

  if (storage.size === 0) {
    section.append(element('div', 'maxkit-empty', 'пусто'));
    return section;
  }

  section.append(definitions([...storage.entries()]));
  return section;
};

/** Панель управления стендом. */
export const createDevHostPanel = ({
  container,
  host,
  onReload,
  autoRefreshMs = 300,
  logLimit = 100,
}: PanelOptions): Panel => {
  container.classList.add('maxkit-panel');

  const style = element('style');
  style.textContent = STYLES;

  const launchSection = element('section');
  const stateSection = element('section');
  const actionsSection = element('section');
  const storagesSection = element('section');
  const logSection = element('section');

  const actions = element('div', 'maxkit-actions');
  const backButton = element('button', undefined, 'Кнопка «назад»');
  const reloadButton = element('button', undefined, 'Перезапустить приложение');
  const clearButton = element('button', undefined, 'Очистить лог');

  backButton.addEventListener('click', () => {
    host.client.pressBackButton();
    render();
  });
  reloadButton.addEventListener('click', () => onReload?.());
  clearButton.addEventListener('click', () => {
    host.log.length = 0;
    render();
  });

  actions.append(backButton, reloadButton, clearButton);
  actionsSection.append(element('h2', undefined, 'Действия'), actions);

  container.append(style, launchSection, stateSection, actionsSection, storagesSection, logSection);

  let lastRenderedLogLength = -1;

  const render = (): void => {
    const { launchParams, state } = host;
    const user = launchParams.initDataUnsafe.user;

    launchSection.replaceChildren(
      element('h2', undefined, 'Запуск'),
      definitions([
        ['Пользователь', user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || String(user.id) : 'нет'],
        ['ID', user ? String(user.id) : 'нет'],
        ['Платформа', launchParams.platform ?? 'нет'],
        ['Версия', launchParams.version ?? 'нет'],
        ['start_param', launchParams.initDataUnsafe.start_param ?? 'нет'],
      ]),
    );

    stateSection.replaceChildren(
      element('h2', undefined, 'Состояние клиента'),
      definitions([
        ['Приложение готово', state.ready ? 'да' : 'нет'],
        ['Кнопка «назад»', state.backButtonVisible ? 'показана' : 'скрыта'],
        ['Подтверждение закрытия', state.closingConfirmation ? 'включено' : 'выключено'],
        ['Вертикальные свайпы', state.verticalSwipesEnabled ? 'разрешены' : 'запрещены'],
        ['Снимок экрана', state.screenCaptureEnabled ? 'разрешён' : 'запрещён'],
        ['Открытые ссылки', state.openedLinks.length > 0 ? state.openedLinks.join(', ') : 'нет'],
      ]),
    );

    storagesSection.replaceChildren();
    storagesSection.append(
      storageTable('Хранилище устройства', state.deviceStorage),
      storageTable('Шифрованное хранилище', state.secureStorage),
    );

    const log = element('div', 'maxkit-log');
    const entries = host.log.slice(-logLimit).reverse();

    if (entries.length === 0) {
      log.append(element('div', 'maxkit-empty', 'событий пока нет'));
    } else {
      for (const entry of entries) {
        const direction = entry.direction === 'out' ? '→' : '←';
        const payload = JSON.stringify(entry.payload);
        const row = element(
          'div',
          entry.direction === 'out' ? 'maxkit-out' : 'maxkit-in',
          `${direction} ${entry.type} ${payload === '{}' ? '' : payload}`.trim(),
        );
        log.append(row);
      }
    }

    logSection.replaceChildren(element('h2', undefined, `События (${host.log.length})`), log);
    lastRenderedLogLength = host.log.length;
  };

  render();

  const timer =
    autoRefreshMs > 0
      ? setInterval(() => {
          if (host.log.length !== lastRenderedLogLength) render();
        }, autoRefreshMs)
      : undefined;

  return {
    update: render,
    destroy: () => {
      if (timer !== undefined) clearInterval(timer);
      container.replaceChildren();
      container.classList.remove('maxkit-panel');
    },
  };
};
