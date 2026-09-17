import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDataCheckString, computeInitDataHash, createBridge, parseInitData, readLaunchParams } from '@maxkit/bridge';

import { DevHost, type DevHostChannel } from '../dist/index.js';

/** Пара соединённых каналов: один конец у стенда, другой у приложения. */
const createChannelPair = (): { host: DevHostChannel; app: DevHostChannel } => {
  const hostListeners = new Set<(message: string) => void>();
  const appListeners = new Set<(message: string) => void>();

  return {
    host: {
      send: (message) => {
        for (const listener of [...appListeners]) listener(message);
      },
      subscribe: (listener) => {
        hostListeners.add(listener);
        return () => hostListeners.delete(listener);
      },
    },
    app: {
      send: (message) => {
        for (const listener of [...hostListeners]) listener(message);
      },
      subscribe: (listener) => {
        appListeners.add(listener);
        return () => appListeners.delete(listener);
      },
    },
  };
};

/** Транспорт моста, работающий поверх канала приложения. */
const createChannelTransport = (channel: DevHostChannel) => {
  const handlers = new Set<(type: string, payload: Record<string, unknown>) => void>();

  channel.subscribe((message) => {
    const { type, ...payload } = JSON.parse(message) as { type: string } & Record<string, unknown>;
    for (const handler of [...handlers]) handler(type, payload);
  });

  return {
    kind: 'mock' as const,
    send: (type: string, payload: Record<string, unknown>) => channel.send(JSON.stringify({ type, ...payload })),
    subscribe: (handler: (type: string, payload: Record<string, unknown>) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
};

describe('адрес запуска', () => {
  it('содержит параметры запуска, которые приложение потом прочитает', async () => {
    const host = await DevHost.create({
      appUrl: 'http://localhost:5173',
      client: { startParam: 'lift_1234', platform: 'ios' },
    });

    const parsed = readLaunchParams({ hash: new URL(host.appUrl).hash, storage: null });

    assert.equal(parsed.platform, 'ios');
    assert.equal(parsed.initDataUnsafe.start_param, 'lift_1234');
    assert.equal(parsed.initData, host.launchParams.initData);
  });

  it('не дублирует hash, если адрес приложения его уже содержит', async () => {
    const host = await DevHost.create({ appUrl: 'http://localhost:5173/#старое' });

    assert.equal(host.appUrl.split('#').length, 2);
  });

  it('подписывает параметры запуска токеном бота', async () => {
    const host = await DevHost.create({ appUrl: 'http://localhost:5173', botToken: 'bot-token' });

    const { dataCheckString, hash } = buildDataCheckString(host.launchParams.initData ?? '');

    assert.equal(await computeInitDataHash(dataCheckString, 'bot-token'), hash);
    assert.equal(parseInitData(host.launchParams.initData).user?.id !== undefined, true);
  });
});

describe('связь стенда с приложением', () => {
  const setup = async () => {
    const host = await DevHost.create({ appUrl: 'http://localhost:5173' });
    const channels = createChannelPair();
    const detach = host.attach(channels.host);

    const bridge = createBridge({
      transport: createChannelTransport(channels.app),
      launchParams: host.launchParams,
    });

    return { host, bridge, detach };
  };

  it('отвечает на запросы приложения по протоколу', async () => {
    const { host, bridge, detach } = await setup();

    await bridge.DeviceStorage.setItem('draft', 'заявка по лифту');
    const value = await bridge.DeviceStorage.getItem('draft');

    assert.equal(value, 'заявка по лифту');
    assert.equal(host.state.deviceStorage.get('draft'), 'заявка по лифту');

    detach();
    bridge.destroy();
  });

  it('доставляет события клиента в приложение', async () => {
    const { host, bridge, detach } = await setup();
    let pressed = 0;

    bridge.BackButton.onClick(() => {
      pressed += 1;
    });
    bridge.BackButton.show();

    assert.equal(host.state.backButtonVisible, true);

    host.client.pressBackButton();
    assert.equal(pressed, 1);

    detach();
    bridge.destroy();
  });

  it('показывает, что приложение отправляло', async () => {
    const { host, bridge, detach } = await setup();

    bridge.ready();
    bridge.openLink('https://max.ru/mock_bot');

    assert.equal(host.state.ready, true);
    assert.deepEqual(host.state.openedLinks, ['https://max.ru/mock_bot']);
    assert.ok(host.log.some((entry) => entry.type === 'WebAppReady'));

    detach();
    bridge.destroy();
  });

  it('после отключения канала события не ходят', async () => {
    const { host, bridge, detach } = await setup();

    detach();
    bridge.ready();

    assert.equal(host.state.ready, false);
    bridge.destroy();
  });

  it('игнорирует посторонние сообщения в канале', async () => {
    const host = await DevHost.create({ appUrl: 'http://localhost:5173' });
    const channels = createChannelPair();
    host.attach(channels.host);

    assert.doesNotThrow(() => {
      channels.app.send('не json');
      channels.app.send(JSON.stringify({ type: 'SomethingElse' }));
      channels.app.send(JSON.stringify(null));
    });

    assert.equal(host.log.length, 0);
    host.detach();
  });
});
