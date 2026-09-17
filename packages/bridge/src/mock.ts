import { MaxBridge, type BridgeOptions } from './client.js';
import { methodSlug } from './errors.js';
import type { RequestEvent, RequestEventMap } from './events.js';
import { buildInitData, parseInitData } from './launch-params.js';
import { signInitData, signPhone } from './signature.js';
import type { BridgeMessageHandler, BridgeTransport } from './transport.js';
import type {
  BiometryInfo,
  InitData,
  InitDataChat,
  InitDataUser,
  LaunchParams,
  MaxPlatform,
  NfcInfo,
  ViewportSize,
} from './types.js';

type MaybePromise<T> = T | Promise<T>;

export type MockHandlers = {
  [E in RequestEvent]?: (params: Record<string, unknown>) => MaybePromise<RequestEventMap[E]['result']>;
};

export interface MockClientConfig {
  user?: InitDataUser;
  chat?: InitDataChat;
  startParam?: string;
  queryId?: string;
  platform?: MaxPlatform;
  version?: string;
  deviceName?: string;
  /** Искусственная задержка ответа. */
  latencyMs?: number;
  phone?: string;
  /** Токен бота: им подписывается телефон, как это делает платформа. */
  botToken?: string;
  biometry?: Partial<BiometryInfo>;
  nfc?: Partial<NfcInfo>;
  viewport?: ViewportSize;
  entryPoint?: 'tabbar' | 'default';
  codeReaderResult?: string;
  /** Лимит ключей шифрованного хранилища. */
  secureStorageLimit?: number;
  /** Переопределение ответов, включая ошибки. */
  handlers?: MockHandlers;
  /** Вызывается на каждое исходящее событие приложения, лента событий в dev-панели. */
  onEvent?: (type: string, payload: Record<string, unknown>) => void;
  /** Сколько последних событий хранить в логе. */
  logLimit?: number;
}

export interface MockLogEntry {
  direction: 'out' | 'in';
  type: string;
  payload: Record<string, unknown>;
  at: number;
}

const DEFAULT_USER: InitDataUser = {
  id: 1_000_001,
  first_name: 'Тест',
  last_name: 'Тестов',
  username: 'test_user',
  language_code: 'ru',
};

const DEFAULT_CHAT: InitDataChat = { id: 2_000_002, type: 'DIALOG' };

/** Документированный лимит шифрованного хранилища: 10 ключей на бота. */
const SECURE_STORAGE_KEY_LIMIT = 10;

const DEFAULT_LOG_LIMIT = 1000;

/** Эмулятор клиента MAX. */
export class MockMaxClient {
  readonly transport: BridgeTransport;
  readonly log: MockLogEntry[] = [];

  /** Состояние клиента, dev-панель показывает его как есть. */
  readonly state = {
    deviceStorage: new Map<string, string>(),
    secureStorage: new Map<string, string>(),
    backButtonVisible: false,
    closingConfirmation: false,
    screenCaptureEnabled: false,
    verticalSwipesEnabled: true,
    maxBrightness: false,
    ready: false,
    closed: false,
    openedLinks: [] as string[],
  };

  private readonly config: MockClientConfig;
  private readonly subscribers = new Set<BridgeMessageHandler>();
  private biometry: BiometryInfo;
  private nfc: NfcInfo;

  constructor(config: MockClientConfig = {}) {
    this.config = config;
    this.biometry = {
      available: true,
      accessRequested: false,
      accessGranted: false,
      type: ['finger'],
      tokenSaved: false,
      deviceId: 'mock-device',
      ...config.biometry,
    };
    this.nfc = { available: true, enabled: true, accessRevoked: false, ...config.nfc };

    this.transport = {
      kind: 'mock',
      send: (type, payload) => void this.handleOutgoing(type, payload),
      subscribe: (handler) => {
        this.subscribers.add(handler);
        return () => this.subscribers.delete(handler);
      },
    };
  }

  /** Отправляет приложению событие от имени клиента, например, нажатие системной «назад». */
  emit(type: string, payload: Record<string, unknown> = {}): void {
    this.record({ direction: 'in', type, payload, at: Date.now() });
    for (const subscriber of this.subscribers) subscriber(type, payload);
  }

  private record(entry: MockLogEntry): void {
    this.log.push(entry);

    const limit = this.config.logLimit ?? DEFAULT_LOG_LIMIT;
    if (this.log.length > limit) this.log.splice(0, this.log.length - limit);
  }

  pressBackButton(): void {
    this.emit('WebAppBackButtonPressed');
  }

  private async handleOutgoing(type: string, payload: Record<string, unknown>): Promise<void> {
    this.record({ direction: 'out', type, payload, at: Date.now() });
    this.config.onEvent?.(type, payload);

    const { requestId, ...params } = payload;
    this.applySideEffects(type, params);

    if (typeof requestId !== 'string') return;

    if (this.config.latencyMs) await new Promise((resolve) => setTimeout(resolve, this.config.latencyMs));

    try {
      const result = await this.resolve(type as RequestEvent, params);
      this.emit(type, { requestId, ...((result ?? {}) as Record<string, unknown>) });
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error).code)
          : `client.${methodSlug(type)}.unknown_error`;
      this.emit(type, { requestId, error: { code } });
    }
  }

  /** События без ответа меняют состояние эмулятора, dev-панель это показывает. */
  private applySideEffects(type: string, params: Record<string, unknown>): void {
    switch (type) {
      case 'WebAppReady':
        this.state.ready = true;
        break;
      case 'WebAppClose':
        this.state.closed = true;
        break;
      case 'WebAppSetupBackButton':
        this.state.backButtonVisible = Boolean(params['isVisible']);
        break;
      case 'WebAppSetupClosingBehavior':
        this.state.closingConfirmation = Boolean(params['needConfirmation']);
        break;
      case 'WebAppOpenLink':
      case 'WebAppOpenMaxLink':
        if (typeof params['url'] === 'string') this.state.openedLinks.push(params['url']);
        break;
      default:
        break;
    }
  }

  private async resolve(type: RequestEvent, params: Record<string, unknown>): Promise<unknown> {
    const override = this.config.handlers?.[type];
    if (override) return override(params);

    const key = typeof params['key'] === 'string' ? params['key'] : '';
    const value = params['value'];

    switch (type) {
      case 'WebAppDeviceStorageSaveKey':
      case 'WebAppSecureStorageSaveKey': {
        const isSecure = type === 'WebAppSecureStorageSaveKey';
        const storage = isSecure ? this.state.secureStorage : this.state.deviceStorage;

        if (value === null || value === undefined) {
          storage.delete(key);
          return {};
        }

        const limit = this.config.secureStorageLimit ?? SECURE_STORAGE_KEY_LIMIT;
        if (isSecure && !storage.has(key) && storage.size >= limit) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- эмулируем протокол клиента
          throw { code: 'client.secure_storage_save_key.limit_exceeded' };
        }

        storage.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        return {};
      }
      case 'WebAppDeviceStorageGetKey':
        return { value: this.state.deviceStorage.get(key) ?? null };
      case 'WebAppSecureStorageGetKey':
        return { value: this.state.secureStorage.get(key) ?? null };
      case 'WebAppDeviceStorageClear':
        this.state.deviceStorage.clear();
        return {};
      case 'WebAppSecureStorageClear':
        this.state.secureStorage.clear();
        return {};

      case 'WebAppBiometryGetInfo':
        return this.biometry;
      case 'WebAppBiometryRequestAccess':
        this.biometry = { ...this.biometry, accessRequested: true, accessGranted: true };
        return this.biometry;
      case 'WebAppBiometryRequestAuth':
        return { token: 'mock-biometric-token' };
      case 'WebAppBiometryUpdateToken':
        this.biometry = { ...this.biometry, tokenSaved: true };
        return { status: 'updated' };
      case 'WebAppBiometryOpenSettings':
        return { status: 'opened' };

      case 'WebAppNfcGetInfo':
        return this.nfc;
      case 'WebAppNfcEmulateNfcTag':
        return {};
      case 'WebAppNfcOpenSystemSettings':
        return { status: 'opened' };

      case 'WebAppHapticFeedbackImpact':
      case 'WebAppHapticFeedbackNotification':
      case 'WebAppHapticFeedbackSelectionChange':
        return {};

      case 'WebAppSetupSwipesBehavior':
        this.state.verticalSwipesEnabled = Boolean(params['allowVerticalSwipes']);
        return { allowVerticalSwipes: this.state.verticalSwipesEnabled };
      case 'WebAppSetupScreenCaptureBehavior':
        this.state.screenCaptureEnabled = Boolean(params['isScreenCaptureEnabled']);
        return { isScreenCaptureEnabled: this.state.screenCaptureEnabled };
      case 'WebAppChangeScreenBrightness':
        this.state.maxBrightness = Boolean(params['maxBrightness']);
        return { maxBrightness: this.state.maxBrightness };

      case 'WebAppRequestPhone': {
        const phone = this.config.phone ?? '79990000000';
        const authDate = String(Math.floor(Date.now() / 1000));
        const userId = this.config.user?.id ?? 0;

        return {
          phone,
          authDate,
          hash: this.config.botToken
            ? await signPhone({ phone, authDate, userId }, this.config.botToken)
            : 'mock-phone-hash',
        };
      }
      case 'WebAppGetViewportSize':
        return this.config.viewport ?? { height: '844', width: '390' };
      case 'WebAppGetLaunchContext':
        return { entryPoint: this.config.entryPoint ?? 'default' };
      case 'WebAppOpenCodeReader':
        return { code: this.config.codeReaderResult ?? 'https://max.ru/mock_bot?startapp=demo' };
      case 'WebAppDownloadFile':
      case 'WebAppShare':
      case 'WebAppMaxShare':
        return {};

      default:
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- клиент MAX отвечает объектом, а не Error
        throw { code: `client.${methodSlug(type)}.not_supported` };
    }
  }
}

const buildMockInitData = (config: MockClientConfig): InitData => ({
  query_id: config.queryId ?? 'mock-query-id',
  auth_date: Math.floor(Date.now() / 1000),
  user: config.user ?? DEFAULT_USER,
  chat: config.chat ?? DEFAULT_CHAT,
  ...(config.startParam ? { start_param: config.startParam } : {}),
});

/** Параметры запуска с фиктивной подписью: серверную проверку они не проходят. */
export const createMockLaunchParams = (config: MockClientConfig = {}): LaunchParams => {
  const initData = `${buildInitData(buildMockInitData(config))}&hash=mock-hash`;

  return {
    initData,
    initDataUnsafe: parseInitData(initData),
    platform: config.platform ?? 'web',
    version: config.version ?? '25.9.16',
    deviceName: config.deviceName ?? 'MaxKit DevHost',
  };
};

/** Параметры запуска с настоящей подписью тестовым токеном бота. */
export const createSignedMockLaunchParams = async (
  botToken: string,
  config: MockClientConfig = {},
): Promise<LaunchParams> => {
  const data = buildMockInitData(config);
  const initData = await signInitData(
    {
      query_id: data.query_id,
      auth_date: data.auth_date,
      user: JSON.stringify(data.user),
      chat: JSON.stringify(data.chat),
      ...(data.start_param ? { start_param: data.start_param } : {}),
    },
    botToken,
  );

  return {
    initData,
    initDataUnsafe: parseInitData(initData),
    platform: config.platform ?? 'web',
    version: config.version ?? '25.9.16',
    deviceName: config.deviceName ?? 'MaxKit DevHost',
  };
};

export interface MockBridge {
  bridge: MaxBridge;
  client: MockMaxClient;
}

/** Мост, подключённый к эмулятору клиента. */
export const createMockBridge = (config: MockClientConfig = {}, options: Omit<BridgeOptions, 'transport'> = {}): MockBridge => {
  const client = new MockMaxClient(config);
  const bridge = new MaxBridge({
    ...options,
    transport: client.transport,
    launchParams: options.launchParams ?? createMockLaunchParams(config),
  });

  return { bridge, client };
};
