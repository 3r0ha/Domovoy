import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

after(async () => {
  await GlobalRegistrator.unregister();
});

const { createMockBridge } = await import('@maxkit/bridge/mock');
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MaxProvider, useClosingConfirmation, useMaxUser, useOptionalBridge, useSupports } = await import(
  '../dist/index.js'
);

const render = async (element: unknown): Promise<{ unmount: () => Promise<void> }> => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container) as unknown as { render: (node: unknown) => void; unmount: () => void };

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

describe('useMaxUser', () => {
  it('отдаёт пользователя из параметров запуска', async () => {
    const { bridge } = createMockBridge({
      user: { id: 501, first_name: 'Мария', last_name: 'Иванова', is_bot: false } as never,
    });
    let user: ReturnType<typeof useMaxUser>;

    const view = await render(
      withProvider(bridge, () => {
        user = useMaxUser();
      }),
    );

    assert.equal(user?.id, 501);
    assert.equal(user?.first_name, 'Мария');

    await view.unmount();
  });
});

describe('useSupports', () => {
  it('скрывает возможности, которых нет на платформе', async () => {
    const { bridge } = createMockBridge({ platform: 'desktop' });
    let nfc = true;
    let backButton = false;

    const view = await render(
      withProvider(bridge, () => {
        nfc = useSupports('nfc');
        backButton = useSupports('backButton');
      }),
    );

    assert.equal(nfc, false, 'NFC на десктопе не предлагаем');
    assert.equal(backButton, true);

    await view.unmount();
  });

  it('на Android NFC доступен', async () => {
    const { bridge } = createMockBridge({ platform: 'android' });
    let nfc = false;

    const view = await render(
      withProvider(bridge, () => {
        nfc = useSupports('nfc');
      }),
    );

    assert.equal(nfc, true);
    await view.unmount();
  });
});

describe('useClosingConfirmation', () => {
  it('включается при несохранённых изменениях и снимается при уходе', async () => {
    const { bridge, client } = createMockBridge();

    const view = await render(withProvider(bridge, () => useClosingConfirmation(true)));
    assert.equal(client.state.closingConfirmation, true);

    await view.unmount();
    assert.equal(client.state.closingConfirmation, false, 'подтверждение не осталось включённым');
  });

  it('не трогает клиент, когда подтверждение не нужно', async () => {
    const { bridge, client } = createMockBridge();

    const view = await render(withProvider(bridge, () => useClosingConfirmation(false)));

    assert.equal(client.state.closingConfirmation, false);
    assert.equal(
      client.log.some((entry) => entry.type === 'WebAppSetupClosingBehavior'),
      false,
      'лишних событий клиенту не отправлено',
    );

    await view.unmount();
  });
});

describe('useOptionalBridge', () => {
  it('вне провайдера возвращает null, а не бросает', async () => {
    let bridge: unknown = 'не трогали';

    const Probe = () => {
      bridge = useOptionalBridge();
      return null;
    };

    const view = await render(createElement(Probe));

    assert.equal(bridge, null);
    await view.unmount();
  });
});
