import { supportsFeature, type MaxFeature } from './capabilities.js';
import { MaxBridgeError, methodSlug, toBridgeError } from './errors.js';
import {
  QUERY_ID_EVENTS,
  type IncomingEvent,
  type IncomingEventMap,
  type NotificationEvent,
  type NotificationEventMap,
  type RequestEvent,
  type RequestEventMap,
} from './events.js';
import { readLaunchParams } from './launch-params.js';
import { BiometricManager } from './modules/biometry.js';
import { NfcManager } from './modules/nfc.js';
import { createDeviceStorage, createSecureStorage, type BridgeStorage } from './modules/storage.js';
import { BackButton, HapticFeedback, ScreenCapture, SwipesBehavior } from './modules/ui.js';
import { RequestController, type RequestOptions } from './request-controller.js';
import { detectTransport, type BridgeTransport, type IframeTransportOptions } from './transport.js';
import type {
  ContactResponse,
  InitData,
  LaunchContext,
  LaunchParams,
  MaxPlatform,
  MaxShareParams,
  ShareParams,
  ViewportSize,
} from './types.js';

export interface BridgeOptions extends IframeTransportOptions {
  /** Готовый транспорт: мок в тестах и в dev-эмуляторе. */
  transport?: BridgeTransport;
  /** Параметры запуска. По умолчанию читаются из hash / sessionStorage. */
  launchParams?: LaunchParams;
  /** Вне клиента MAX отвечать некому. */
  failFastOutsideMax?: boolean;
}

type IncomingHandler<E extends IncomingEvent> = (payload: IncomingEventMap[E]) => void;

const MID_PATTERN = /^[0-9a-f]{32}$/i;

const parseMid = (mid: string, chatType: 'DIALOG' | 'CHAT'): { chatId: string; messageId: string } => {
  const raw = mid.replace(/^mid\./, '');

  if (!MID_PATTERN.test(raw)) {
    throw new MaxBridgeError(
      'client.web_app_max_share.invalid_request',
      `Некорректный mid: ожидались 32 hex-символа, получено «${mid}»`,
    );
  }

  const chatPart = raw.slice(0, 16);
  const messagePart = raw.slice(16);

  let chatId = BigInt(`0x${chatPart}`);
  const messageId = BigInt(`0x${messagePart}`);
  if (chatType === 'CHAT') chatId -= 2n ** 64n;

  return { chatId: chatId.toString(), messageId: messageId.toString() };
};

/** Типизированный клиент MAX Bridge. */
export class MaxBridge {
  readonly BackButton: BackButton;
  readonly DeviceStorage: BridgeStorage;
  readonly SecureStorage: BridgeStorage;
  readonly BiometricManager: BiometricManager;
  readonly NfcManager: NfcManager;
  readonly HapticFeedback: HapticFeedback;
  readonly ScreenCapture: ScreenCapture;

  private readonly transport: BridgeTransport;
  private readonly controller: RequestController;
  private readonly launchParams: LaunchParams;
  private readonly handlers = new Map<string, Set<(payload: Record<string, unknown>) => void>>();
  private readonly swipes: SwipesBehavior;
  private readonly unsubscribeTransport: () => void;
  private readonly failFastOutsideMax: boolean;
  private readonly anyHandlers = new Set<(type: string, payload: Record<string, unknown>) => void>();
  private destroyed = false;

  constructor(options: BridgeOptions = {}) {
    this.transport = options.transport ?? detectTransport(options);
    this.launchParams = options.launchParams ?? readLaunchParams();
    this.failFastOutsideMax = options.failFastOutsideMax ?? true;
    this.controller = new RequestController(this.transport);

    this.unsubscribeTransport = this.transport.subscribe((type, payload) => {
      if (this.controller.handleMessage(type, payload)) return;
      this.dispatch(type, payload);
    });

    const request = this.request.bind(this);

    this.BackButton = new BackButton({
      setVisible: (isVisible) => this.postEvent('WebAppSetupBackButton', { isVisible }),
      onPressed: (callback) => this.on('WebAppBackButtonPressed', callback),
    });
    this.DeviceStorage = createDeviceStorage(request);
    this.SecureStorage = createSecureStorage(request);
    this.BiometricManager = new BiometricManager(request);
    this.NfcManager = new NfcManager(request);
    this.HapticFeedback = new HapticFeedback(request);
    this.ScreenCapture = new ScreenCapture(request);
    this.swipes = new SwipesBehavior(request);
  }

  /** Сырая строка `WebAppData`: её отправляют на сервер для проверки подписи. */
  get initData(): string | null {
    return this.launchParams.initData;
  }

  /** Разобранные данные запуска. Непроверенные: любые решения по доступу принимает сервер. */
  get initDataUnsafe(): InitData {
    return this.launchParams.initDataUnsafe;
  }

  get platform(): MaxPlatform | null {
    return this.launchParams.platform;
  }

  get version(): string | null {
    return this.launchParams.version;
  }

  get deviceName(): string | null {
    return this.launchParams.deviceName;
  }

  /** Приложение открыто внутри клиента MAX или его эмулятора. */
  get isInsideMax(): boolean {
    return this.transport.kind !== 'none';
  }

  get transportKind(): BridgeTransport['kind'] {
    return this.transport.kind;
  }

  get isVerticalSwipesEnabled(): boolean {
    return this.swipes.isEnabled;
  }

  /** Сколько запросов ждут ответа клиента. */
  get pendingRequests(): number {
    return this.controller.pendingCount;
  }

  /** Поддерживается ли возможность текущим клиентом. */
  supports(feature: MaxFeature): boolean {
    return supportsFeature(feature, { platform: this.platform, version: this.version });
  }

  request<E extends RequestEvent>(
    type: E,
    params: RequestEventMap[E]['params'] = {},
    options: RequestOptions = {},
  ): Promise<RequestEventMap[E]['result']> {
    if (this.destroyed) {
      return Promise.reject(new MaxBridgeError('client.bridge.destroyed', 'Мост уже уничтожен'));
    }

    if (this.failFastOutsideMax && this.transport.kind === 'none') {
      return Promise.reject(
        new MaxBridgeError(
          `client.${methodSlug(type)}.not_available`,
          'Приложение открыто вне клиента MAX: отвечать на запрос некому',
        ),
      );
    }

    const payload: Record<string, unknown> = { ...(params as Record<string, unknown>) };
    if (QUERY_ID_EVENTS.includes(type)) payload['queryId'] = this.launchParams.initDataUnsafe.query_id;
    return this.controller.request(type, payload, options);
  }

  postEvent<E extends NotificationEvent>(
    type: E,
    payload: NotificationEventMap[E] = {} as NotificationEventMap[E],
  ): void {
    if (this.destroyed) {
      console.warn(`[maxkit] Событие ${type} не отправлено: мост уничтожен`);
      return;
    }

    this.transport.send(type, payload);
  }

  /** Подписка на события клиента. @returns функция отписки. */
  on<E extends IncomingEvent>(type: E, handler: IncomingHandler<E>): () => void {
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }
    handlers.add(handler);

    return () => {
      const set = this.handlers.get(type);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(type);
    };
  }

  /** Подписка на все входящие события, включая те, которых ещё нет в типах. */
  onAny(handler: (type: string, payload: Record<string, unknown>) => void): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  /** Сообщает клиенту, что приложение отрисовано. Вызывать после первого полезного рендера. */
  ready(): void {
    this.postEvent('WebAppReady');
  }

  close(): void {
    this.postEvent('WebAppClose');
  }

  enableClosingConfirmation(): void {
    this.postEvent('WebAppSetupClosingBehavior', { needConfirmation: true });
  }

  disableClosingConfirmation(): void {
    this.postEvent('WebAppSetupClosingBehavior', { needConfirmation: false });
  }

  /** Запрашивает телефон. `hash` из ответа проверяется на сервере, см. `@maxkit/server`. */
  requestContact(options?: RequestOptions): Promise<ContactResponse> {
    return this.request('WebAppRequestPhone', {}, options);
  }

  getViewportSize(options?: RequestOptions): Promise<ViewportSize> {
    return this.request('WebAppGetViewportSize', {}, options);
  }

  getLaunchContext(options?: RequestOptions): Promise<LaunchContext> {
    return this.request('WebAppGetLaunchContext', {}, options);
  }

  openLink(url: string): void {
    this.postEvent('WebAppOpenLink', { url });
  }

  openMaxLink(url: string): void {
    this.postEvent('WebAppOpenMaxLink', { url });
  }

  downloadFile(url: string, fileName: string, options?: RequestOptions): Promise<void> {
    return this.request('WebAppDownloadFile', { url, file_name: fileName }, options);
  }

  shareContent(params: ShareParams, options?: RequestOptions): Promise<void> {
    return this.request('WebAppShare', params, options);
  }

  /** Шеринг внутрь MAX: либо текст/ссылка, либо конкретное сообщение по `mid`. */
  shareMaxContent(params: MaxShareParams, options?: RequestOptions): Promise<void> {
    let payload: ShareParams | { chatId: string; messageId: string };

    try {
      payload = 'mid' in params ? parseMid(params.mid, params.chatType) : params;
    } catch (error) {
      return Promise.reject(toBridgeError(error));
    }

    return this.request('WebAppMaxShare', payload, options);
  }

  openCodeReader(fileSelect = true, options?: RequestOptions): Promise<{ code?: string } & Record<string, unknown>> {
    return this.request('WebAppOpenCodeReader', { fileSelect }, options);
  }

  /** Максимальная яркость на 30 секунд, например, для показа QR-кода на проходной. */
  requestScreenMaxBrightness(options?: RequestOptions): Promise<{ maxBrightness: boolean }> {
    return this.request('WebAppChangeScreenBrightness', { maxBrightness: true }, options);
  }

  restoreScreenBrightness(options?: RequestOptions): Promise<{ maxBrightness: boolean }> {
    return this.request('WebAppChangeScreenBrightness', { maxBrightness: false }, options);
  }

  enableVerticalSwipes(): Promise<{ allowVerticalSwipes: boolean }> {
    return this.swipes.enable();
  }

  disableVerticalSwipes(): Promise<{ allowVerticalSwipes: boolean }> {
    return this.swipes.disable();
  }

  /** Отписывается от транспорта и отклоняет незавершённые запросы. Повторный вызов безопасен. */
  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.unsubscribeTransport();
    this.transport.destroy?.();
    this.controller.destroy();
    this.handlers.clear();
    this.anyHandlers.clear();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  private dispatch(type: string, payload: Record<string, unknown>): void {
    for (const handler of this.anyHandlers) {
      try {
        handler(type, payload);
      } catch (error) {
        console.error(`[maxkit] Ошибка в обработчике onAny для "${type}":`, error);
      }
    }

    const handlers = this.handlers.get(type);
    if (!handlers) return;

    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[maxkit] Ошибка в обработчике события "${type}":`, error);
      }
    }
  }
}

let singleton: MaxBridge | null = null;

export const createBridge = (options: BridgeOptions = {}): MaxBridge => new MaxBridge(options);

/** Ленивый синглтон для приложения: первый вызов создаёт мост, последующие возвращают его же. */
export const getBridge = (options: BridgeOptions = {}): MaxBridge => {
  if (singleton && !singleton.isDestroyed) {
    if (Object.keys(options).length > 0) {
      console.warn('[maxkit] getBridge: мост уже создан, переданные параметры игнорируются');
    }
    return singleton;
  }

  singleton = new MaxBridge(options);
  return singleton;
};

/** Сбрасывает синглтон (тесты, hot reload). */
export const resetBridge = (): void => {
  singleton?.destroy();
  singleton = null;
};
