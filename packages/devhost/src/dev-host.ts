import { buildLaunchHash, type LaunchParams } from '@maxkit/bridge';
import { MockMaxClient, createMockLaunchParams, createSignedMockLaunchParams, type MockClientConfig } from '@maxkit/bridge/mock';

import type { DevHostChannel } from './channel.js';

export interface DevHostOptions {
  /** Адрес мини-приложения, например `http://localhost:5173`. */
  appUrl: string;
  /** Настройки эмулируемого клиента: пользователь, чат, платформа, задержки. */
  client?: MockClientConfig;
  /** Токен бота. */
  botToken?: string;
}

/** Стенд для мини-приложения. */
export class DevHost {
  private detachChannel: (() => void) | null = null;

  private constructor(
    readonly client: MockMaxClient,
    readonly launchParams: LaunchParams,
    private readonly options: DevHostOptions,
  ) {}

  static async create(options: DevHostOptions): Promise<DevHost> {
    const config = options.client ?? {};
    const launchParams = options.botToken
      ? await createSignedMockLaunchParams(options.botToken, config)
      : createMockLaunchParams(config);

    const client = new MockMaxClient(options.botToken ? { ...config, botToken: options.botToken } : config);

    return new DevHost(client, launchParams, options);
  }

  /** Адрес, по которому нужно открыть приложение: с параметрами запуска в hash. */
  get appUrl(): string {
    const base = this.options.appUrl.split('#')[0] ?? this.options.appUrl;
    return base + buildLaunchHash(this.launchParams);
  }

  get log(): MockMaxClient['log'] {
    return this.client.log;
  }

  get state(): MockMaxClient['state'] {
    return this.client.state;
  }

  /** Подключает канал к приложению. @returns функция отключения. */
  attach(channel: DevHostChannel): () => void {
    this.detach();

    const fromApp = channel.subscribe((message) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }

      if (typeof parsed !== 'object' || parsed === null) return;
      const { type, ...payload } = parsed as { type?: unknown } & Record<string, unknown>;
      if (typeof type !== 'string' || !type.startsWith('WebApp')) return;

      this.client.transport.send(type, payload);
    });

    const toApp = this.client.transport.subscribe((type, payload) => {
      channel.send(JSON.stringify({ type, ...payload }));
    });

    this.detachChannel = () => {
      fromApp();
      toApp();
    };

    return () => this.detach();
  }

  detach(): void {
    this.detachChannel?.();
    this.detachChannel = null;
  }
}
