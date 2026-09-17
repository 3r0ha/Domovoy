import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { ReactNode } from 'react';

GlobalRegistrator.register({ url: 'http://localhost/' });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

after(async () => {
  await GlobalRegistrator.unregister();
});

const { createMockBridge } = await import('@maxkit/bridge/mock');
const { MaxBridgeError } = await import('@maxkit/bridge');
const { createElement, act, Component } = await import('react');
const { createRoot } = await import('react-dom/client');
const {
  MaxProvider,
  useBackButton,
  useBridge,
  useBridgeRequest,
  useLaunchParams,
  useStorageValue,
} = await import('../dist/index.js');

type Root = { unmount: () => void };

const render = async (element: unknown): Promise<{ unmount: () => Promise<void> }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container) as unknown as Root & { render: (node: unknown) => void };

  await act(async () => {
    root.render(element);
  });

  return {
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const withProvider = (bridge: unknown, hook: () => void) => {
  const Probe = () => {
    hook();
    return null;
  };

  return createElement(MaxProvider as never, { bridge, autoReady: false } as never, createElement(Probe));
};

describe('MaxProvider', () => {
  it('отдаёт мост потомкам и сообщает клиенту о готовности', async () => {
    const { bridge, client } = createMockBridge();
    let received: unknown;

    const Probe = () => {
      received = useBridge();
      return null;
    };

    const view = await render(createElement(MaxProvider as never, { bridge } as never, createElement(Probe)));

    assert.equal(received, bridge);
    assert.equal(client.state.ready, true, 'вызван ready()');

    await view.unmount();
  });

  it('не уничтожает мост, переданный снаружи', async () => {
    const { bridge } = createMockBridge();

    const view = await render(withProvider(bridge, () => undefined));
    await view.unmount();

    assert.equal(bridge.isDestroyed, false, 'мостом распоряжается вызывающий код');
  });

  it('строгий режим не оставляет приложение с уничтоженным мостом', async () => {
    const { StrictMode } = await import('react');

    let received: { isDestroyed: boolean } | undefined;

    const Probe = () => {
      received = useBridge();
      return null;
    };

    const view = await render(
      createElement(
        StrictMode as never,
        null,
        createElement(MaxProvider as never, { autoReady: false } as never, createElement(Probe)),
      ),
    );

    assert.equal(received?.isDestroyed, false, 'приложение получило живой мост');

    await view.unmount();
  });

  it('требует провайдер', async () => {
    let captured: Error | undefined;

    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      override state = { failed: false };

      static getDerivedStateFromError() {
        return { failed: true };
      }

      override componentDidCatch(error: Error) {
        captured = error;
      }

      override render() {
        return this.state.failed ? null : this.props.children;
      }
    }

    const Probe = () => {
      useBridge();
      return null;
    };

    const view = await render(createElement(Boundary, null, createElement(Probe)));

    assert.match(captured?.message ?? '', /внутри MaxProvider/);
    await view.unmount();
  });
});

describe('useLaunchParams', () => {
  it('отдаёт параметры запуска', async () => {
    const { bridge } = createMockBridge({ startParam: 'lift_1234', platform: 'ios' });
    let launch: ReturnType<typeof useLaunchParams> | undefined;

    const view = await render(
      withProvider(bridge, () => {
        launch = useLaunchParams();
      }),
    );

    assert.equal(launch?.platform, 'ios');
    assert.equal(launch?.initDataUnsafe.start_param, 'lift_1234');
    assert.equal(launch?.isInsideMax, true);

    await view.unmount();
  });
});

describe('useBackButton', () => {
  it('показывает кнопку на экране и убирает при уходе', async () => {
    const { bridge, client } = createMockBridge();

    const view = await render(withProvider(bridge, () => useBackButton()));
    assert.equal(client.state.backButtonVisible, true);

    await view.unmount();
    assert.equal(client.state.backButtonVisible, false, 'кнопка не осталась висеть');
  });

  it('вызывает обработчик нажатия', async () => {
    const { bridge, client } = createMockBridge();
    let pressed = 0;

    const view = await render(withProvider(bridge, () => useBackButton({ onClick: () => { pressed += 1; } })));

    await act(async () => {
      client.pressBackButton();
    });

    assert.equal(pressed, 1);
    await view.unmount();

    client.pressBackButton();
    assert.equal(pressed, 1, 'после размонтирования обработчик не вызывается');
  });

  it('скрытая кнопка не показывается', async () => {
    const { bridge, client } = createMockBridge();

    const view = await render(withProvider(bridge, () => useBackButton({ visible: false })));

    assert.equal(client.state.backButtonVisible, false);
    await view.unmount();
  });
});

describe('useStorageValue', () => {
  it('читает и записывает значение', async () => {
    const { bridge, client } = createMockBridge();
    await bridge.DeviceStorage.setItem('draft', 'заявка по лифту');

    let state: ReturnType<typeof useStorageValue> | undefined;
    const view = await render(
      withProvider(bridge, () => {
        state = useStorageValue('draft');
      }),
    );

    assert.equal(state?.value, 'заявка по лифту');
    assert.equal(state?.loading, false);

    await act(async () => {
      await state?.save('другой текст');
    });

    assert.equal(state?.value, 'другой текст');
    assert.equal(client.state.deviceStorage.get('draft'), 'другой текст');

    await view.unmount();
  });

  it('удаляет значение', async () => {
    const { bridge, client } = createMockBridge();
    await bridge.SecureStorage.setItem('token', 'секрет');

    let state: ReturnType<typeof useStorageValue> | undefined;
    const view = await render(
      withProvider(bridge, () => {
        state = useStorageValue('token', 'secure');
      }),
    );

    assert.equal(state?.value, 'секрет');

    await act(async () => {
      await state?.remove();
    });

    assert.equal(state?.value, null);
    assert.equal(client.state.secureStorage.has('token'), false);

    await view.unmount();
  });
});

describe('useBridgeRequest', () => {
  it('отдаёт результат и снимает признак загрузки', async () => {
    const { bridge } = createMockBridge({ viewport: { height: '844', width: '390' } });
    let state: ReturnType<typeof useBridgeRequest<{ height: string }>> | undefined;

    const view = await render(
      withProvider(bridge, () => {
        state = useBridgeRequest((signal) => bridge.getViewportSize({ signal }), [bridge]);
      }),
    );

    assert.equal(state?.loading, false);
    assert.equal(state?.data?.height, '844');

    await view.unmount();
  });

  it('отменяет запрос при уходе с экрана', async () => {
    const { bridge } = createMockBridge({
      handlers: { WebAppGetViewportSize: () => new Promise(() => undefined) },
    });

    const view = await render(
      withProvider(bridge, () => {
        useBridgeRequest((signal) => bridge.getViewportSize({ signal }), [bridge]);
      }),
    );

    assert.equal(bridge.pendingRequests, 1);

    await view.unmount();
    assert.equal(bridge.pendingRequests, 0, 'висящий запрос отменён');
  });

  it('повторяет запрос по требованию', async () => {
    const { bridge } = createMockBridge();
    let calls = 0;
    let state: ReturnType<typeof useBridgeRequest<number>> | undefined;

    const view = await render(
      withProvider(bridge, () => {
        state = useBridgeRequest(async () => {
          calls += 1;
          return calls;
        }, []);
      }),
    );

    assert.equal(state?.data, 1);

    await act(async () => {
      state?.reload();
    });

    assert.equal(state?.data, 2);
    await view.unmount();
  });

  it('неудачное обновление не стирает показанное', async () => {
    const { bridge } = createMockBridge();
    let calls = 0;
    let state: ReturnType<typeof useBridgeRequest<number>> | undefined;

    const view = await render(
      withProvider(bridge, () => {
        state = useBridgeRequest(async () => {
          calls += 1;
          if (calls > 1) throw new Error('связь пропала');
          return calls;
        }, []);
      }),
    );

    assert.equal(state?.data, 1);

    await act(async () => {
      state?.reload();
    });

    assert.equal(state?.data, 1, 'старые данные остались на экране');
    assert.ok(state?.error, 'при этом видно, что обновиться не вышло');

    await view.unmount();
  });

  it('сообщает об ошибке клиента', async () => {
    const { bridge } = createMockBridge({
      handlers: {
        WebAppGetViewportSize: () => {
          throw { code: 'client.get_viewport_size.not_supported' };
        },
      },
    });

    let state: ReturnType<typeof useBridgeRequest<unknown>> | undefined;
    const view = await render(
      withProvider(bridge, () => {
        state = useBridgeRequest((signal) => bridge.getViewportSize({ signal }), [bridge]);
      }),
    );

    assert.equal(state?.loading, false);
    assert.ok(state?.error instanceof MaxBridgeError);
    assert.equal(state.error.isUnsupported, true);

    await view.unmount();
  });
});
