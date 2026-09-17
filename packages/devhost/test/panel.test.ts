import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

after(async () => {
  await GlobalRegistrator.unregister();
});

const { createDevHostPanel, DevHost } = await import('../dist/index.js');

const setup = async () => {
  const host = await DevHost.create({
    appUrl: 'http://localhost:5173',
    client: { startParam: 'lift_1234', platform: 'ios', user: { id: 77, first_name: 'Жилец', is_bot: false } as never },
  });

  const container = document.createElement('div');
  document.body.append(container);

  const panel = createDevHostPanel({ container, host, autoRefreshMs: 0 });

  return { host, container, panel };
};

describe('панель стенда', () => {
  it('показывает параметры запуска', async () => {
    const { container, panel } = await setup();

    const text = container.textContent ?? '';
    assert.match(text, /Жилец/);
    assert.match(text, /lift_1234/);
    assert.match(text, /ios/);

    panel.destroy();
  });

  it('показывает пустой лог до первых событий', async () => {
    const { container, panel } = await setup();

    assert.match(container.textContent ?? '', /событий пока нет/);
    panel.destroy();
  });

  it('показывает события приложения после обновления', async () => {
    const { host, container, panel } = await setup();

    host.client.transport.send('WebAppReady', {});
    panel.update();

    const text = container.textContent ?? '';
    assert.match(text, /WebAppReady/);
    assert.match(text, /Приложение готово\s*да/);

    panel.destroy();
  });

  it('показывает содержимое хранилищ', async () => {
    const { host, container, panel } = await setup();

    host.client.state.deviceStorage.set('draft', 'заявка по лифту');
    panel.update();

    assert.match(container.textContent ?? '', /draft/);
    assert.match(container.textContent ?? '', /заявка по лифту/);

    panel.destroy();
  });

  it('кнопка нажимает системную «назад»', async () => {
    const { host, container, panel } = await setup();
    let pressed = 0;

    host.client.transport.subscribe((type) => {
      if (type === 'WebAppBackButtonPressed') pressed += 1;
    });

    const button = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('назад'));
    button?.dispatchEvent(new Event('click'));

    assert.equal(pressed, 1);
    panel.destroy();
  });

  it('кнопка очищает лог', async () => {
    const { host, container, panel } = await setup();

    host.client.transport.send('WebAppReady', {});
    panel.update();
    assert.match(container.textContent ?? '', /WebAppReady/);

    const button = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('Очистить'));
    button?.dispatchEvent(new Event('click'));

    assert.match(container.textContent ?? '', /событий пока нет/);
    assert.equal(host.log.length, 0);

    panel.destroy();
  });

  it('после destroy контейнер пуст', async () => {
    const { container, panel } = await setup();

    panel.destroy();

    assert.equal(container.childNodes.length, 0);
    assert.equal(container.className, '');
  });
});
