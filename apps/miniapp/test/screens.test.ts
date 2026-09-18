import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

after(async () => {
  await GlobalRegistrator.unregister();
});

const { createMockBridge } = await import('@maxkit/bridge/mock');
const { MaxProvider } = await import('@maxkit/react');
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { DomovoyApi } = await import('../dist-test/api.js');
const { Toasts } = await import('../dist-test/toast.js');
const { AnnouncementsScreen } = await import('../dist-test/screens/AnnouncementsScreen.js');
const { BindApartmentScreen } = await import('../dist-test/screens/BindApartmentScreen.js');
const { NewRequestScreen } = await import('../dist-test/screens/NewRequestScreen.js');
const { MetersScreen } = await import('../dist-test/screens/MetersScreen.js');
const { DemoScreen } = await import('../dist-test/screens/DemoScreen.js');
const { DocumentScreen } = await import('../dist-test/screens/DocumentScreen.js');
const { Tour } = await import('../dist-test/screens/Tour.js');
const { Assistant } = await import('../dist-test/screens/Assistant.js');
const { Consent } = await import('../dist-test/screens/Consent.js');
const { PollsScreen } = await import('../dist-test/screens/PollsScreen.js');
const { QualityScreen } = await import('../dist-test/screens/QualityScreen.js');
const { QueueScreen } = await import('../dist-test/screens/QueueScreen.js');
const { ReportScreen } = await import('../dist-test/screens/ReportScreen.js');
const { RequestListScreen } = await import('../dist-test/screens/RequestListScreen.js');
const { RequestScreen } = await import('../dist-test/screens/RequestScreen.js');
const { ResidentsScreen } = await import('../dist-test/screens/ResidentsScreen.js');
const { codeFromScan } = await import('../dist-test/screens/ScanCode.js');
const { TariffsScreen } = await import('../dist-test/screens/TariffsScreen.js');
const { VisitsScreen } = await import('../dist-test/screens/VisitsScreen.js');
const { ImportScreen } = await import('../dist-test/screens/ImportScreen.js');
const { BuildingsScreen } = await import('../dist-test/screens/BuildingsScreen.js');
const { AuditScreen } = await import('../dist-test/screens/AuditScreen.js');
const { ProfileScreen } = await import('../dist-test/screens/ProfileScreen.js');
const { GuestScreen } = await import('../dist-test/screens/GuestScreen.js');
const { StickersScreen } = await import('../dist-test/screens/StickersScreen.js');
const { SupportScreen } = await import('../dist-test/screens/SupportScreen.js');
const { BroadcastScreen } = await import('../dist-test/screens/BroadcastScreen.js');
const { HomeScreen } = await import('../dist-test/screens/HomeScreen.js');
const { ObjectScreen, failuresByMonth, objectHistory } = await import('../dist-test/screens/ObjectScreen.js');
const { InspectionsScreen } = await import('../dist-test/screens/InspectionsScreen.js');

interface Recorded {
  path: string;
  method: string;
  body?: string;
}

const stubFetch = (replies: Record<string, unknown>) => {
  const calls: Recorded[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace('http://api.test', '');

    calls.push({
      path,
      method: init?.method ?? 'GET',
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });

    const method = init?.method ?? 'GET';
    const key =
      Object.keys(replies).find((candidate) => `${method} ${path}`.startsWith(candidate)) ??
      Object.keys(replies).find((candidate) => path.startsWith(candidate));

    const reply = key === undefined ? {} : replies[key];

    return Promise.resolve(
      new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  };

  return { fetchStub, calls };
};

const render = async (element: unknown, bridge: unknown) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container) as unknown as { render: (node: unknown) => void; unmount: () => void };

  await act(async () => {
    root.render(createElement(MaxProvider as never, { bridge, autoReady: false } as never, element as never));
  });

  await act(async () => {
    await Promise.resolve();
  });

  return {
    get text(): string {
      return container.textContent ?? '';
    },
    find: <T extends Element>(selector: string): T => {
      const found = container.querySelector<T>(selector);
      assert.ok(found, `нет элемента «${selector}»`);
      return found;
    },
    findAll: <T extends Element = Element>(selector: string): T[] => [...container.querySelectorAll<T>(selector)],
    /** Тот же экран с другими свойствами: так приложение просит перечитать данные. */
    rerender: async (next: unknown) => {
      await act(async () => {
        root.render(createElement(MaxProvider as never, { bridge, autoReady: false } as never, next as never));
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
    act: async (run: () => void) => {
      await act(async () => {
        run();
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const apiWith = (replies: Record<string, unknown>) => {
  const { fetchStub, calls } = stubFetch(replies);
  return { api: new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub }), calls };
};

/** Сервер, который на всё отвечает отказом: так выглядит нехватка прав или связи. */
const apiRefusing = (status: number, code: string, message: string) => {
  const calls: Recorded[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    calls.push({ path: url.replace('http://api.test', ''), method: init?.method ?? 'GET' });

    return Promise.resolve(
      new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { api: new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub }), calls };
};

const REQUEST = {
  id: 'req-1',
  number: 'Д15-2609-0001',
  category: 'plumbing',
  categoryTitle: 'Водоснабжение и канализация',
  priority: 'normal',
  status: 'new',
  title: 'Течёт кран',
  description: 'Течёт кран на кухне, вода капает постоянно',
  target: 'квартира 1',
  createdAt: '2026-09-03T10:00:00Z',
  reactionDueAt: '2026-09-03T10:30:00Z',
  resolutionDueAt: '2026-09-04T10:00:00Z',
  dueAt: '2026-09-03T10:30:00Z',
  overdue: false,
  reactionOverdue: false,
  reporters: 1,
  incident: false,
  reopenCount: 0,
  attachments: [],
  history: [],
};

/** Объект без истории обращений: так отвечает сервер на свежую наклейку. */
const EMPTY_PASSPORT = {
  startParam: 'ent_b1_1',
  target: 'подъезд 1',
  open: [],
  history: [],
  totalRequests: 0,
};

/** Меняет значение поля так, как это делает React: через нативный сеттер. */
const typeInto = (field: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  const prototype =
    field instanceof globalThis.HTMLInputElement
      ? globalThis.HTMLInputElement.prototype
      : globalThis.HTMLTextAreaElement.prototype;

  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
};

/** Нажатие по подписи: разметка кита меняется, а слова на экране остаются. */
const tap = (screen: { findAll: <T extends Element = Element>(selector: string) => T[] }, text: string): void => {
  const found = screen
    .findAll('button, a, [class*="Tappable"]')
    .filter((node) => (node.textContent ?? '').includes(text))
    .at(-1);

  assert.ok(found, `нечего нажать: «${text}»`);
  (found as HTMLElement).click();
};

describe('оформление заявки', () => {
  it('пустой экран встречает частыми поломками, а не серым полем', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({});

    const screen = await render(
      createElement(NewRequestScreen as never, { api, where: 'Квартира 1', onCreated: () => undefined } as never),
      bridge,
    );

    const chips = screen.findAll('.chat-common .chip');

    assert.ok(chips.length > 0, 'подсказок с частыми поломками нет');
    assert.ok(screen.find('.chat')?.className.includes('chat-fresh'), 'содержимое прижато к низу экрана');

    await screen.act(() => (chips[0] as HTMLButtonElement).click());

    assert.equal(screen.find<HTMLTextAreaElement>('#description').value, chips[0]?.textContent);

    await screen.unmount();
  });

  it('показывает объект с наклейки вместо вопроса об адресе', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/context': { target: 'подъезд 1', audience: 'подъезд 1', buildingId: 'b1' },
      '/api/objects': EMPTY_PASSPORT,
    });

    const screen = await render(
      createElement(NewRequestScreen as never, { api, startParam: 'ent_b1_1', onCreated: () => undefined } as never),
      bridge,
    );

    assert.match(screen.text, /подъезд 1/);

    await screen.unmount();
  });

  it('без кода объекта обещает создать заявку по квартире', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({});

    const screen = await render(
      createElement(NewRequestScreen as never, { api, where: 'Квартира 1', onCreated: () => undefined } as never),
      bridge,
    );

    assert.match(screen.text, /Квартира 1/, 'жилец должен знать, куда уйдёт заявка');
    assert.equal(screen.findAll('[aria-label="Сканировать код"]').length, 1, 'код читают значком');

    await screen.unmount();
  });

  it('пустое описание до сервера не доходит', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({});
    let created = 0;

    const screen = await render(
      createElement(NewRequestScreen as never, { api, onCreated: () => (created += 1) } as never),
      bridge,
    );

    assert.equal(screen.find<HTMLButtonElement>('.composer-send').disabled, true, 'пустое не отправить');

    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());

    assert.equal(created, 0);
    assert.equal(calls.length, 0, 'сервер не дёргается ради заведомо неверной заявки');

    await screen.unmount();
  });

  it('отправленная заявка уходит с кодом объекта и переключает экран', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests': { joined: false, request: REQUEST },
      '/api/context': { target: 'подъезд 1' },
      '/api/objects': EMPTY_PASSPORT,
    });
    let created = 0;

    const screen = await render(
      createElement(NewRequestScreen as never, {
        api,
        startParam: 'ent_b1_1',
        onCreated: () => (created += 1),
      } as never),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('textarea'), '  Течёт кран  '));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { description: 'Течёт кран', startParam: 'ent_b1_1' });
    assert.equal(created, 1);

    await screen.unmount();
  });

  it('уточняющий вопрос задаётся после заявки, а ответ уходит по ней сообщением', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests': { joined: false, request: REQUEST, question: 'На каком этаже?' },
      '/api/requests/req-1/comment': REQUEST,
    });
    let created = 0;

    const screen = await render(
      createElement(NewRequestScreen as never, { api, onCreated: () => (created += 1) } as never),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('textarea'), 'Не горит лампа'));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());

    assert.match(screen.text, /Заявка принята/);
    assert.match(screen.text, /На каком этаже\?/);
    assert.equal(created, 0, 'вопрос ещё на экране: уводить рано');

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('#description'), 'На третьем'));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());

    const comment = calls.find((call) => call.path.endsWith('/comment'));

    assert.deepEqual(JSON.parse(comment?.body ?? '{}'), { text: 'На третьем' });
    assert.equal(created, 1);

    await screen.unmount();
  });

  it('пропущенный вопрос заявку не задерживает', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests': { joined: false, request: REQUEST, question: 'На каком этаже?' },
    });
    let created = 0;

    const screen = await render(
      createElement(NewRequestScreen as never, { api, onCreated: () => (created += 1) } as never),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('textarea'), 'Не горит лампа'));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());
    await screen.act(() => tap(screen, 'Пропустить'));

    assert.equal(created, 1);
    assert.equal(calls.filter((call) => call.path.endsWith('/comment')).length, 0);

    await screen.unmount();
  });

  it('во время плановых работ показывает срок вместо номера заявки', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests': {
        joined: false,
        planned: {
          title: 'Замена задвижки',
          category: 'plumbing',
          until: '2026-09-03T14:00:00Z',
          message: 'Водоснабжение и канализация: плановые работы до 17:00.\nЗамена задвижки, подъезд 1, стояк 1.',
        },
      },
    });
    let created = 0;

    const screen = await render(
      createElement(NewRequestScreen as never, { api, onCreated: () => (created += 1) } as never),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('textarea'), 'Нет горячей воды'));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());

    assert.match(screen.text, /плановые работы до 17:00/);
    assert.equal(created, 0, 'к списку заявок не уводим: заявки нет');

    await screen.unmount();
  });

  it('«всё равно оставить заявку» уходит с тем же текстом, а не пустым', async () => {
    const { bridge } = createMockBridge();
    let attempt = 0;

    const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      attempt += 1;
      calls.push({
        path: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
      });

      const reply =
        attempt === 1
          ? {
              joined: false,
              planned: { title: 'Замена задвижки', category: 'plumbing', until: '', message: 'Работы до 17:00.' },
            }
          : { joined: false, request: REQUEST };

      return Promise.resolve(
        new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    };

    const calls: { path: string; method: string; body: string }[] = [];
    const api = new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub });
    let created = 0;

    const screen = await render(
      createElement(NewRequestScreen as never, { api, onCreated: () => (created += 1) } as never),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('textarea'), 'Нет горячей воды'));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());

    const insist = screen.findAll('button').find((button) => /это другое/i.test(button.textContent ?? ''));
    assert.ok(insist, 'нет кнопки «это другое»');

    await screen.act(() => (insist as HTMLButtonElement).click());

    assert.deepEqual(JSON.parse(calls[1]?.body ?? '{}'), {
      description: 'Нет горячей воды',
      anyway: true,
    });
    assert.equal(created, 1);

    await screen.unmount();
  });
});

describe('обращение присоединено к чужой заявке', () => {
  it('жильцу объясняют, что дубль не нужен', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests': { joined: true, request: { ...REQUEST, reporters: 3, incident: true } },
      '/api/context': { target: 'подъезд 1' },
      '/api/objects': EMPTY_PASSPORT,
    });
    let created = 0;

    const screen = await render(
      createElement(NewRequestScreen as never, {
        api,
        startParam: 'ent_b1_1',
        onCreated: () => (created += 1),
      } as never),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('textarea'), 'Нет горячей воды'));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());

    assert.match(screen.text, /Уже чиним/i);
    assert.match(screen.text, /Течёт кран/);
    assert.match(screen.text, /ообщили: 3/);
    assert.equal(created, 0, 'экран не переключается сам');

    await screen.act(() => screen.find<HTMLButtonElement>('button').click());
    assert.equal(created, 1);

    await screen.unmount();
  });

  it('жилец может завести свою заявку, если приписали не к той', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests': { joined: true, request: { ...REQUEST, reporters: 2 } },
      '/api/context': { target: 'подъезд 1' },
      '/api/objects': EMPTY_PASSPORT,
    });

    const screen = await render(
      createElement(NewRequestScreen as never, { api, startParam: 'ent_b1_1', onCreated: () => {} } as never),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('textarea'), 'Течёт кран на кухне'));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());
    await screen.act(() =>
      (screen.findAll('button').find((button) => button.textContent === 'Это другое') as HTMLButtonElement).click(),
    );

    const insisted = calls.filter((call) => call.path === '/api/requests' && call.method === 'POST').at(-1);

    assert.deepEqual(JSON.parse(insisted?.body ?? '{}'), {
      description: 'Течёт кран на кухне',
      startParam: 'ent_b1_1',
      anyway: true,
    });

    await screen.unmount();
  });

  it('открытая заявка по объекту видна до отправки', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/context': { target: 'подъезд 1' },
      '/api/objects': { ...EMPTY_PASSPORT, open: [REQUEST], totalRequests: 1 },
    });

    const screen = await render(
      createElement(NewRequestScreen as never, { api, startParam: 'ent_b1_1', onCreated: () => undefined } as never),
      bridge,
    );

    assert.match(screen.text, /уже сообщили/);
    assert.match(screen.text, /Течёт кран/);

    await screen.unmount();
  });

  it('подтверждение уже открытой заявки не требует ни слова', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/context': { target: 'подъезд 1' },
      '/api/objects': { ...EMPTY_PASSPORT, open: [REQUEST], totalRequests: 1 },
      '/api/requests/req-1/answer': { ...REQUEST, reporters: 2 },
    });

    const screen = await render(
      createElement(NewRequestScreen as never, { api, startParam: 'ent_b1_1', onCreated: () => undefined } as never),
      bridge,
    );

    const confirm = screen
      .findAll('button')
      .find((button) => button.textContent === 'У меня то же самое') as HTMLButtonElement;

    await screen.act(() => confirm.click());

    const sent = calls.find((call) => call.method === 'POST');

    assert.match(sent?.path ?? '', /\/answer$/);
    assert.deepEqual(JSON.parse(sent?.body ?? '{}'), { affected: true });
    assert.match(screen.text, /Уже чиним/i);
    assert.match(screen.text, /ообщили: 2/);

    await screen.unmount();
  });

  it('без открытых заявок показывается история объекта', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/context': { target: 'оборудование lift-1' },
      '/api/objects': { ...EMPTY_PASSPORT, totalRequests: 4, lastRepairAt: '2026-03-12T10:00:00Z' },
    });

    const screen = await render(
      createElement(NewRequestScreen as never, { api, startParam: 'eqp_b1_lift-1', onCreated: () => undefined } as never),
      bridge,
    );

    assert.match(screen.text, /4 обращения · ремонт 12 марта/);

    await screen.unmount();
  });
});

describe('список заявок', () => {
  it('строка списка отвечает на «что, где и что с ней»', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/requests': [REQUEST] });

    const screen = await render(
      createElement(RequestListScreen as never, { api, onOpen: () => {} } as never),
      bridge,
    );

    assert.match(screen.text, /Течёт кран/);
    assert.match(screen.text, /квартира\u00a01/);
    assert.match(screen.text, /отправлена/);
    assert.doesNotMatch(screen.text, /Д15-2609-0001/);

    await screen.unmount();
  });

  it('пустая работа смены не тупик: из неё уходят в очередь дома', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/requests': [] });
    let toQueue = 0;

    const screen = await render(
      createElement(RequestListScreen as never, {
        api,
        staff: true,
        onQueue: () => (toQueue += 1),
        onNewRequest: () => undefined,
        onOpen: () => undefined,
      } as never),
      bridge,
    );

    assert.match(screen.text, /Нарядов нет/);
    assert.match(screen.text, /Заявка по звонку/);

    await screen.act(() => tap(screen, 'В очередь'));

    assert.equal(toQueue, 1);

    await screen.unmount();
  });

  it('подрядчику без очереди дома пустой экран лишних дорог не показывает', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/requests': [] });

    const screen = await render(
      createElement(RequestListScreen as never, { api, staff: true, onOpen: () => undefined } as never),
      bridge,
    );

    assert.match(screen.text, /Нарядов нет/);
    assert.doesNotMatch(screen.text, /В очередь/);

    await screen.unmount();
  });

  it('просроченная заявка выделяется, а не теряется в списке', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/requests': [{ ...REQUEST, overdue: true, reactionOverdue: true }] });

    const screen = await render(
      createElement(RequestListScreen as never, { api, onOpen: () => {} } as never),
      bridge,
    );

    assert.equal(screen.findAll('.request-row-overdue').length, 1);
    assert.match(screen.text, /просрочено/);

    await screen.unmount();
  });

  it('нажатие открывает заявку', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/requests': [REQUEST] });
    const opened: string[] = [];

    const screen = await render(
      createElement(RequestListScreen as never, {
        api,
        onOpen: (id: string) => opened.push(id),
      } as never),
      bridge,
    );

    await screen.act(() => screen.find<HTMLElement>('.request-row').click());

    assert.deepEqual(opened, ['req-1']);

    await screen.unmount();
  });

  it('закрытые заявки не грузятся, пока их не открыли', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests?scope=closed': [{ ...REQUEST, status: 'confirmed', rating: 4 }],
      '/api/requests': [],
    });

    const screen = await render(
      createElement(RequestListScreen as never, { api, onOpen: () => {} } as never),
      bridge,
    );

    assert.equal(screen.findAll('.request-row').length, 0);
    assert.equal(calls.some((call) => call.path.includes('scope=closed')), false, 'до нажатия не читаем');

    await screen.act(() => tap(screen, 'Закрытые заявки'));

    assert.equal(screen.findAll('.request-row').length, 1);
    assert.equal(calls.filter((call) => call.path.includes('scope=closed')).length, 1);

    await screen.unmount();
  });

  it('следующая страница закрытых читается от последней показанной', async () => {
    const { bridge } = createMockBridge();
    const page = Array.from({ length: 20 }, (_, index) => ({
      ...REQUEST,
      id: `req-${index}`,
      status: 'confirmed',
      createdAt: new Date(Date.UTC(2026, 8, 20 - index)).toISOString(),
    }));
    const { api, calls } = apiWith({ '/api/requests?scope=closed': page, '/api/requests': [] });

    const screen = await render(
      createElement(RequestListScreen as never, { api, onOpen: () => {} } as never),
      bridge,
    );

    await screen.act(() => tap(screen, 'Закрытые заявки'));

    const more = screen.findAll('button').find((button) => button.textContent === 'Показать ещё');

    assert.ok(more, 'полная страница обещает продолжение');

    await screen.act(() => (more as HTMLButtonElement).click());

    const last = calls.filter((call) => call.path.includes('scope=closed')).at(-1);

    assert.match(last?.path ?? '', /before=2026-09-01/, 'курсор, время последней показанной');

    await screen.unmount();
  });

  it('авария по дому видна раньше, чем жилец заведёт такую же', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests': [],
      '/api/now': {
        mood: 'alarmed',
        incidents: [
          {
            id: 'req-9',
            title: 'Нет горячей воды',
            target: 'Подъезд 1, стояк 2',
            status: 'in_progress',
            resolutionDueAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
            reporters: 3,
          },
        ],
        works: [],
      },
    });
    const opened: string[] = [];

    const screen = await render(
      createElement(RequestListScreen as never, {
        api,
        onOpen: (id: string) => opened.push(id),
      } as never),
      bridge,
    );

    assert.match(screen.text, /Авария в доме/);
    assert.match(screen.text, /Нет горячей воды/);
    assert.doesNotMatch(screen.text, /Сейчас в доме/, 'состояние дома называется один раз, а не двумя подписями подряд');

    await screen.act(() => tap(screen, 'Нет горячей воды'));

    assert.deepEqual(opened, ['req-9']);

    await screen.unmount();
  });

  it('в спокойном доме домовой спит и списка происшествий нет', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests': [],
      '/api/now': { mood: 'sleeping', incidents: [], works: [] },
    });

    const screen = await render(
      createElement(RequestListScreen as never, { api, onOpen: () => {} } as never),
      bridge,
    );

    assert.match(screen.text, /В доме спокойно/);
    assert.doesNotMatch(screen.text, /Сейчас в доме/);

    await screen.unmount();
  });

  it('сотруднику сводка по дому не показывается: у него очередь', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/requests': [REQUEST] });

    const screen = await render(
      createElement(RequestListScreen as never, { api, staff: true, onOpen: () => {} } as never),
      bridge,
    );

    assert.doesNotMatch(screen.text, /Сейчас в доме/);
    assert.equal(calls.some((call) => call.path.includes('/api/now')), false, 'лишнего запроса нет');

    await screen.unmount();
  });

  it('пустой список зовёт оставить заявку', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/requests': [] });
    let asked = 0;

    const screen = await render(
      createElement(RequestListScreen as never, {
        api,
        onOpen: () => {},
        onNewRequest: () => (asked += 1),
      } as never),
      bridge,
    );

    assert.match(screen.text, /Открытых заявок нет/);

    await screen.act(() => screen.find<HTMLButtonElement>('.empty button').click());

    assert.equal(asked, 1);

    await screen.unmount();
  });
});

describe('экран заявки', () => {
  const openRequest = async (request: Record<string, unknown>, props: Record<string, unknown> = {}) => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests/req-1/transition': { ...REQUEST, ...request },
      '/api/requests/req-1/comment': { ...REQUEST, ...request },
      '/api/requests/req-1/actions': { actions: [] },
      '/api/requests/req-1/complaint': {
        possible: true,
        reason: 'заявка не принята в работу',
        complaint: 'В Государственную жилищную инспекцию\n...',
      },
      '/api/requests/req-1': { ...REQUEST, ...request },
      ...(props.replies as Record<string, unknown> | undefined),
    });

    const screen = await render(
      createElement(RequestScreen as never, { api, id: 'req-1', ...props } as never),
      bridge,
    );

    return { screen, calls };
  };

  it('нарушенный срок называется просрочкой, а не четырьмя разными словами', async () => {
    const { screen } = await openRequest({ status: 'in_progress', overdue: true, dueAt: '2026-09-03T10:00:00Z' });

    assert.match(screen.text, /просрочено/);
    assert.doesNotMatch(screen.text, /срок нарушен|ответ просрочен|Срок вышел/);

    await screen.unmount();
  });

  it('вместо описания регламента стоит сам срок: день и час', async () => {
    const { screen } = await openRequest({
      status: 'in_progress',
      deadlineBasis: 'Срок по регламенту организации: он задан для этой категории и срочности',
      resolutionDueAt: '2026-12-24T09:15:00Z',
    });

    assert.match(screen.text, /Срок работ: 24 декабря в \d{2}:\d{2}/);
    assert.doesNotMatch(screen.text, /регламент/);

    await screen.unmount();
  });

  it('из карточки заявки есть возврат к списку, из которого её открыли', async () => {
    let back = 0;
    const { screen } = await openRequest({}, { onBack: () => (back += 1), backTitle: 'Очередь' });

    await screen.act(() => screen.find<HTMLButtonElement>('.back-link').click());

    assert.equal(back, 1);
    assert.match(screen.find('.back-link')?.textContent ?? '', /Очередь/);

    await screen.unmount();
  });

  it('без возврата ссылки нет: у жильца стопка может начинаться с заявки', async () => {
    const { screen } = await openRequest({});

    assert.equal(screen.findAll('.back-link').length, 0);

    await screen.unmount();
  });

  it('показывает состояние, адрес и историю', async () => {
    const { screen } = await openRequest({
      history: [
        { at: '2026-09-03T10:00:00Z', status: 'new', role: 'resident' },
        { at: '2026-09-03T11:00:00Z', status: 'accepted', role: 'dispatcher', comment: 'Выехали' },
      ],
    });

    assert.match(screen.text, /Течёт кран/);
    assert.match(screen.text, /квартира\u00a01/);
    assert.match(screen.text, /Выехали/);
    assert.equal(screen.findAll('.timeline li').length, 3);
    assert.equal(screen.findAll('.due-mark').length, 1);

    await screen.unmount();
  });

  it('к сообщению по заявке прикладывается фото', async () => {
    const { screen, calls } = await openRequest(
      { status: 'in_progress' },
      { replies: { 'POST /api/uploads/photo': { kind: 'photo', token: 'file:photo-1' } } },
    );

    assert.ok(screen.findAll('input[type="file"]').length > 0, 'рядом с полем есть выбор снимка');

    await screen.act(() =>
      typeInto(screen.find<HTMLTextAreaElement>('textarea[aria-label="Сообщение по заявке"]'), 'Всё ещё течёт'),
    );
    await screen.act(() => screen.find<HTMLButtonElement>('.talk .composer-send').click());

    const sent = calls.find((call) => call.path === '/api/requests/req-1/comment');

    assert.equal(JSON.parse(sent?.body ?? '{}').text, 'Всё ещё течёт');

    await screen.unmount();
  });

  it('метка срока стоит в ленте на своём месте', async () => {
    const { screen } = await openRequest({
      resolutionDueAt: '2026-09-03T10:30:00Z',
      history: [
        { at: '2026-09-03T10:00:00Z', status: 'new', role: 'resident' },
        { at: '2026-09-03T12:00:00Z', status: 'accepted', role: 'dispatcher' },
      ],
    });

    const rows = screen.findAll('.timeline li');

    assert.ok(rows[1]?.className.includes('due-mark'), 'срок должен стоять между событиями');
    assert.match(rows[1]?.textContent ?? '', /Просрочено/, 'нарушенный срок называется одним словом везде');

    await screen.unmount();
  });

  it('у снятой заявки срока в ленте нет', async () => {
    const { screen } = await openRequest({ status: 'withdrawn' });

    assert.equal(screen.findAll('.due-mark').length, 0);

    await screen.unmount();
  });

  it('оценка уходит вместе с приёмкой', async () => {
    const { screen, calls } = await openRequest({ status: 'done' });

    await screen.act(() => (screen.findAll('.rating button')[4] as HTMLButtonElement).click());
    await screen.act(() => screen.find<HTMLButtonElement>('.actions button, .actions-more button').click());

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { to: 'confirmed', rating: 5 });

    await screen.unmount();
  });

  it('без оценки работа всё равно принимается', async () => {
    const { screen, calls } = await openRequest({ status: 'done' });

    await screen.act(() => screen.find<HTMLButtonElement>('.actions button, .actions-more button').click());

    assert.deepEqual(JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}'), { to: 'confirmed' });

    await screen.unmount();
  });

  it('возврат работы требует причины', async () => {
    const { screen, calls } = await openRequest({ status: 'done' });

    await screen.act(() => (screen.findAll('.actions button, .actions-more button')[1] as HTMLButtonElement).click());

    assert.match(screen.text, /Что не сделано/);
    assert.equal(
      (screen.findAll('.actions button, .actions-more button')[0] as HTMLButtonElement).disabled,
      true,
      'без причины возвращать нечего',
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('textarea'), 'Вода так и не появилась'));
    await screen.act(() => (screen.findAll('.actions button, .actions-more button')[0] as HTMLButtonElement).click());

    assert.deepEqual(JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}'), {
      to: 'in_progress',
      comment: 'Вода так и не появилась',
    });

    await screen.unmount();
  });

  it('жилец отвечает на уточнение', async () => {
    const { screen, calls } = await openRequest({
      status: 'needs_info',
      history: [
        { at: '2026-09-03T10:00:00Z', status: 'new', role: 'resident' },
        { at: '2026-09-03T11:00:00Z', status: 'needs_info', role: 'dispatcher', comment: 'Соседи тоже без воды?' },
      ],
    });

    assert.match(screen.text, /Соседи тоже без воды\?/);

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('.talk textarea'), 'Да, у соседей тоже'));
    await screen.act(() => screen.find<HTMLButtonElement>('.talk .composer-send').click());

    assert.deepEqual(JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}'), {
      to: 'in_progress',
      comment: 'Да, у соседей тоже',
    });

    await screen.unmount();
  });

  it('жилец видит, кто ведёт работу', async () => {
    const { screen } = await openRequest({ status: 'in_progress', assigneeId: 'tech-1', assigneeName: 'Сергей' });

    assert.match(screen.text, /Работу ведёт Сергей/);

    await screen.unmount();
  });

  it('жилец пишет по идущей заявке, не трогая её состояния', async () => {
    const { screen, calls } = await openRequest({ status: 'in_progress' });

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('.talk textarea'), 'Когда будете?'));
    await screen.act(() => screen.find<HTMLButtonElement>('.talk .composer-send').click());

    const sent = calls.find((call) => call.method === 'POST');

    assert.match(sent?.path ?? '', /\/comment$/);
    assert.deepEqual(JSON.parse(sent?.body ?? '{}'), { text: 'Когда будете?' });

    await screen.unmount();
  });

  it('по закрытой заявке писать некуда', async () => {
    const { screen } = await openRequest({ status: 'confirmed' });

    assert.equal(screen.findAll('.talk').length, 0, 'разговор по закрытой заявке ничего не изменит');

    await screen.unmount();
  });

  it('сказанное отличается в ленте от смены состояния', async () => {
    const { screen } = await openRequest({
      status: 'in_progress',
      history: [
        { at: '2026-09-03T10:00:00Z', status: 'new', role: 'resident' },
        { at: '2026-09-03T11:00:00Z', status: 'in_progress', role: 'technician' },
        {
          at: '2026-09-03T12:00:00Z',
          status: 'in_progress',
          role: 'technician',
          kind: 'message',
          comment: 'Будем после обеда',
        },
      ],
    });

    assert.equal(screen.findAll('.timeline li.said').length, 1);
    assert.match(screen.find<HTMLElement>('.timeline li.said').textContent ?? '', /Управляющая компания/);

    await screen.unmount();
  });

  it('на общей заявке сообщение соседа не выдаётся за своё', async () => {
    const { screen } = await openRequest({
      status: 'in_progress',
      reporters: 3,
      history: [
        { at: '2026-09-03T10:00:00Z', status: 'new', role: 'resident' },
        {
          at: '2026-09-03T11:00:00Z',
          status: 'in_progress',
          role: 'resident',
          kind: 'message',
          comment: 'У меня то же самое',
          speaker: 'neighbour',
        },
        {
          at: '2026-09-03T12:00:00Z',
          status: 'in_progress',
          role: 'resident',
          kind: 'message',
          comment: 'И у меня',
          speaker: 'you',
        },
      ],
    });

    const said = screen.findAll<HTMLElement>('.timeline li.said');

    assert.match(said[0]?.textContent ?? '', /Сосед/);
    assert.equal(said[0]?.querySelectorAll('.bubble-mine').length, 0);
    // Своё сообщение подписи не требует: оно справа и своим цветом, как в переписке.
    assert.equal(said[1]?.querySelectorAll('.bubble-author').length, 0);
    assert.equal(said[1]?.querySelectorAll('.bubble-mine').length, 1);
    assert.equal(screen.find<HTMLTextAreaElement>('.talk textarea').placeholder, 'Написать соседям и в УК');

    await screen.unmount();
  });

  it('к соседу сверху стучат из заявки, и только пока не постучали', async () => {
    const { screen, calls } = await openRequest({ canKnock: true });

    const knock = screen
      .findAll<HTMLElement>('button')
      .find((button) => (button.textContent ?? '').includes('Постучать'));

    assert.notEqual(knock, undefined);

    await screen.act(() => {
      knock?.click();
    });

    assert.equal(calls.some((call) => call.path === '/api/requests/req-1/knock' && call.method === 'POST'), true);

    await screen.unmount();

    const knocked = await openRequest({ knocked: true });

    assert.match(knocked.screen.text, /Соседу сверху постучали/);
    assert.equal(/Постучать/.test(knocked.screen.text), false);

    await knocked.screen.unmount();
  });

  it('обращение в ГЖИ предлагается только по просроченной заявке', async () => {
    const { screen } = await openRequest({});

    assert.equal(screen.findAll('.complaint button').length, 0, 'сроки соблюдаются, жаловаться не на что');

    await screen.unmount();
  });

  it('по просроченной заявке предлагается отправка, а текст открывается по ссылке', async () => {
    const opened: { title: string; text: string }[] = [];
    const { screen } = await openRequest(
      { overdue: true, reactionOverdue: true },
      { onDocument: (title: string, text: string) => opened.push({ title, text }) },
    );

    await screen.act(() => screen.find<HTMLButtonElement>('.complaint button').click());

    assert.match(screen.text, /заявка не принята в работу/);
    assert.match(screen.text, /Отправить жалобу/);
    assert.equal(opened.length, 0, 'текст сам по себе не открывается: человек решает, читать ли его');

    // Читать обращение необязательно, но возможность есть.
    await screen.act(() => screen.findAll<HTMLButtonElement>('.complaint button').at(-1)?.click());

    assert.equal(opened[0]?.title, 'Жалоба в жилинспекцию');
    assert.equal(opened[0]?.text.startsWith('В Государственную'), true);

    await screen.unmount();
  });

  it('вложения показываются, а битые картинки не рисуются', async () => {
    const { screen } = await openRequest({
      attachments: [
        { kind: 'photo', token: 'https://files.test/photo.jpg' },
        { kind: 'photo', token: 'opaque-token' },
        { kind: 'voice', token: 'voice-1', transcript: 'нет горячей воды' },
      ],
    });

    assert.equal(screen.findAll('.attachments img').length, 1, 'рисуем только прямую ссылку');
    assert.match(screen.text, /голосовое: нет горячей воды/);

    await screen.unmount();
  });
});

describe('очередь сотрудника', () => {
  it('пустая очередь оставляет заявку по звонку', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/requests': [] });
    let asked = 0;

    const screen = await render(
      createElement(QueueScreen as never, { api, onOpen: () => {}, onNewRequest: () => (asked += 1) } as never),
      bridge,
    );

    assert.match(screen.text, /Очередь пуста/);

    const call = screen.findAll('[role="button"], button').find((node) => (node.textContent ?? '').includes('звонку'));

    assert.ok(call, 'заявку по звонку из пустой очереди не завести');
    await screen.act(() => (call as HTMLElement).click());

    assert.equal(asked, 1);

    await screen.unmount();
  });

  it('состояние названо тем, что оно значит для сотрудника', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/requests': [{ ...REQUEST, status: 'done' }] });

    const screen = await render(createElement(QueueScreen as never, { api, onOpen: () => {} } as never), bridge);

    assert.match(screen.text, /ждёт приёмки/);

    await screen.unmount();
  });

  it('отбор оставляет в очереди только нужное', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests': [
        { ...REQUEST, id: 'req-1', number: 'Д15-1', category: 'plumbing', categoryTitle: 'Водоснабжение' },
        {
          ...REQUEST,
          id: 'req-2',
          number: 'Д15-2',
          category: 'elevator',
          categoryTitle: 'Лифт',
          overdue: true,
        },
      ],
    });

    const screen = await render(createElement(QueueScreen as never, { api, onOpen: () => {} } as never), bridge);

    assert.match(screen.text, /Д15-1/);
    assert.match(screen.text, /Д15-2/);

    const chip = (title: string) =>
      screen.findAll('.filters button').find((button) => (button.textContent ?? '').startsWith(title));

    assert.deepEqual(
      screen.findAll('.filters button').map((button) => button.textContent),
      ['Все · 2', 'Просрочено · 1', 'Новые · 2', 'Водоснабжение · 1', 'Лифт · 1'],
    );

    await screen.act(() => (chip('Просрочено') as HTMLButtonElement).click());

    assert.equal(/Д15-1/.test(screen.text), false);
    assert.match(screen.text, /Д15-2/);

    await screen.act(() => (chip('Водоснабжение') as HTMLButtonElement).click());

    assert.match(screen.text, /Д15-1/);
    assert.equal(/Д15-2/.test(screen.text), false);

    await screen.unmount();
  });

  it('порядок очереди задаёт сервер, экран его не переставляет', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests': [
        { ...REQUEST, id: 'req-2', number: 'Д15-2', dueAt: '2026-09-01T10:00:00Z', overdue: true },
        { ...REQUEST, id: 'req-3', number: 'Д15-3', dueAt: '2026-09-04T10:00:00Z' },
        { ...REQUEST, id: 'req-1', number: 'Д15-1', dueAt: '2026-09-05T10:00:00Z' },
      ],
    });

    const screen = await render(createElement(QueueScreen as never, { api, onOpen: () => {} } as never), bridge);

    assert.deepEqual(
      screen.findAll('.request-row .row-number').map((node) => (node.textContent ?? '').trim()),
      ['· Д15-2', '· Д15-3', '· Д15-1'],
    );

    await screen.unmount();
  });

  it('новую заявку диспетчер принимает прямо из очереди', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests': [{ ...REQUEST, id: 'req-1', number: 'Д15-1', status: 'new' }],
    });

    const screen = await render(
      createElement(QueueScreen as never, { api, canAccept: true, onOpen: () => {} } as never),
      bridge,
    );

    await screen.act(() => tap(screen, 'Взять'));

    const post = calls.find((call) => call.method === 'POST');

    assert.equal(post?.path, '/api/requests/req-1/transition');
    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { to: 'accepted' });

    await screen.unmount();
  });

  it('изменение заявки перечитывает очередь, не сбрасывая поиск', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests': [
        { ...REQUEST, id: 'req-1', number: 'Д15-1', title: 'Течёт кран' },
        { ...REQUEST, id: 'req-2', number: 'Д15-2', title: 'Не работает лифт' },
      ],
    });

    const props = { api, onOpen: () => {} };
    const screen = await render(createElement(QueueScreen as never, { ...props, version: 0 } as never), bridge);

    await screen.act(() => typeInto(screen.find<HTMLInputElement>('#queue-search'), 'лифт'));

    assert.equal(screen.text.includes('Течёт кран'), false, 'поиск не отобрал');

    const before = calls.length;

    await screen.rerender(createElement(QueueScreen as never, { ...props, version: 1 } as never));

    assert.ok(calls.length > before, 'очередь не перечиталась');
    assert.equal(screen.find<HTMLInputElement>('#queue-search').value, 'лифт', 'поиск сбросился');
    assert.equal(screen.text.includes('Течёт кран'), false, 'отбор сбросился');

    await screen.unmount();
  });

  it('мастеру кнопки «Принять» не показывают: заявки принимает диспетчер', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests': [{ ...REQUEST, id: 'req-1', number: 'Д15-1', status: 'new' }],
    });

    const screen = await render(createElement(QueueScreen as never, { api, onOpen: () => {} } as never), bridge);

    assert.equal(screen.findAll('.row-action').length, 0);

    await screen.unmount();
  });

  it('заявку без мастера отбирают отдельной кнопкой', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests': [
        { ...REQUEST, id: 'req-1', number: 'Д15-1', status: 'accepted' },
        { ...REQUEST, id: 'req-2', number: 'Д15-2', status: 'in_progress', assigneeId: 'staff-1' },
      ],
    });

    const screen = await render(createElement(QueueScreen as never, { api, onOpen: () => {} } as never), bridge);

    const chip = screen
      .findAll('.filters button')
      .find((button) => (button.textContent ?? '').startsWith('Без мастера'));

    assert.ok(chip, 'кнопка отбора появилась');

    await screen.act(() => (chip as HTMLButtonElement).click());

    assert.match(screen.text, /Д15-1/);
    assert.equal(/Д15-2/.test(screen.text), false);

    await screen.unmount();
  });

  it('поиск ищет по номеру, адресу и сути', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests': [
        {
          ...REQUEST,
          id: 'req-1',
          number: 'Д15-1',
          title: 'Течёт кран',
          description: 'Течёт кран',
          target: 'квартира 1',
        },
        {
          ...REQUEST,
          id: 'req-2',
          number: 'Д15-2',
          title: 'Не работает лифт',
          description: 'Не работает лифт',
          target: 'Лифт, подъезд 3',
        },
      ],
    });

    const screen = await render(createElement(QueueScreen as never, { api, onOpen: () => {} } as never), bridge);
    const search = screen.find<HTMLInputElement>('input[type="search"]');

    await screen.act(() => typeInto(search, 'подъезд 3'));

    assert.equal(/Д15-1/.test(screen.text), false);
    assert.match(screen.text, /Д15-2/);

    await screen.act(() => typeInto(search, 'кран'));

    assert.match(screen.text, /Д15-1/);
    assert.equal(/Д15-2/.test(screen.text), false);

    await screen.unmount();
  });

  it('пустой отбор объясняет, что заявки есть, просто не эти', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/requests': [REQUEST] });

    const screen = await render(createElement(QueueScreen as never, { api, onOpen: () => {} } as never), bridge);

    await screen.act(() => typeInto(screen.find<HTMLInputElement>('input[type="search"]'), 'ничего такого'));

    assert.match(screen.text, /Ничего не нашлось/);

    await screen.unmount();
  });
});

describe('действия сотрудника над заявкой', () => {
  const openAs = async (
    replies: Record<string, unknown>,
    request: Record<string, unknown> = {},
    props: Record<string, unknown> = {},
  ) => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ ...replies, '/api/requests/req-1': { ...REQUEST, ...request } });

    const screen = await render(
      createElement(RequestScreen as never, { api, id: 'req-1', staff: true, ...props } as never),
      bridge,
    );

    return { screen, calls };
  };

  it('показывает только те кнопки, которые разрешены роли', async () => {
    const { screen } = await openAs({ '/api/requests/req-1/actions': { actions: ['accepted', 'rejected'] } });

    assert.deepEqual(
      screen.findAll('.actions button, .actions-more button').map((button) => button.textContent),
      ['Взять', 'Отклонить'],
    );

    await screen.unmount();
  });

  it('исполнителя выбирают с оглядкой на загрузку', async () => {
    const { screen, calls } = await openAs({
      '/api/requests/req-1/actions': { actions: ['in_progress'] },
      '/api/requests/req-1/transition': { ...REQUEST, status: 'in_progress' },
      '/api/staff': [
        { id: 'tech-1', displayName: 'Сергей', role: 'technician', load: 2 },
        { id: 'tech-2', displayName: 'Пётр', role: 'technician', load: 0 },
      ],
    });

    assert.match(screen.text, /Сергей · в работе 2/);

    const select = screen.find<HTMLSelectElement>('.assignee select');

    await screen.act(() => {
      select.value = 'tech-2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await screen.act(() => screen.find<HTMLButtonElement>('.actions button, .actions-more button').click());

    assert.deepEqual(JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}'), {
      to: 'in_progress',
      assigneeId: 'tech-2',
    });

    await screen.unmount();
  });

  it('назначенный исполнитель уже выбран в списке', async () => {
    const { screen } = await openAs(
      {
        '/api/requests/req-1/actions': { actions: ['in_progress'] },
        '/api/staff': [
          { id: 'tech-1', displayName: 'Сергей', role: 'technician', load: 2 },
          { id: 'tech-2', displayName: 'Пётр', role: 'technician', load: 0 },
        ],
      },
      { assigneeId: 'tech-2', assigneeName: 'Пётр' },
    );

    assert.equal(screen.find<HTMLSelectElement>('.assignee select').value, 'tech-2');

    await screen.unmount();
  });

  it('без исполнителя заявка в работу не уходит', async () => {
    const { screen, calls } = await openAs({
      '/api/requests/req-1/actions': { actions: ['in_progress'] },
      '/api/requests/req-1/transition': { ...REQUEST, status: 'in_progress' },
      '/api/staff': [{ id: 'tech-1', displayName: 'Сергей', role: 'technician', load: 2 }],
    });

    const go = screen.find<HTMLButtonElement>('.actions button');

    assert.equal(go.disabled, true);
    assert.match(screen.text, /Выберите исполнителя/);

    await screen.act(() => go.click());

    assert.equal(
      calls.find((call) => call.method === 'POST'),
      undefined,
      'ничей наряд в работе никем не делается',
    );

    await screen.unmount();
  });

  it('выбранный исполнитель открывает переход в работу', async () => {
    const { screen, calls } = await openAs({
      '/api/requests/req-1/actions': { actions: ['in_progress'] },
      '/api/requests/req-1/transition': { ...REQUEST, status: 'in_progress' },
      '/api/staff': [{ id: 'tech-1', displayName: 'Сергей', role: 'technician', load: 2 }],
    });

    await screen.act(() => {
      const select = screen.find<HTMLSelectElement>('.assignee select');

      select.value = 'tech-1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await screen.act(() => screen.find<HTMLButtonElement>('.actions button').click());

    assert.deepEqual(JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}'), {
      to: 'in_progress',
      assigneeId: 'tech-1',
    });

    await screen.unmount();
  });

  it('мастер берёт наряд на себя, исполнителя выбирать не надо', async () => {
    const { screen, calls } = await openAs(
      {
        '/api/requests/req-1/actions': { actions: ['in_progress'] },
        '/api/requests/req-1/transition': { ...REQUEST, status: 'in_progress' },
        '/api/staff': [{ id: 'tech-1', displayName: 'Сергей', role: 'technician', load: 2 }],
      },
      {},
      { selfAssigned: true },
    );

    const go = screen.find<HTMLButtonElement>('.actions button');

    assert.equal(go.disabled, false);

    await screen.act(() => go.click());

    assert.deepEqual(JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}'), { to: 'in_progress' });

    await screen.unmount();
  });

  it('отказ без причины не отправляется', async () => {
    globalThis.prompt = () => null;

    const { screen, calls } = await openAs({ '/api/requests/req-1/actions': { actions: ['rejected'] } });

    await screen.act(() => screen.find<HTMLButtonElement>('.actions button, .actions-more button').click());

    assert.equal(
      calls.some((call) => call.method === 'POST'),
      false,
    );

    await screen.unmount();
  });

  it('причина отказа спрашивается на экране и уходит вместе с переходом', async () => {
    const { screen, calls } = await openAs({
      '/api/requests/req-1/actions': { actions: ['rejected'] },
      '/api/requests/req-1/transition': { ...REQUEST, status: 'rejected' },
    });

    await screen.act(() => screen.find<HTMLButtonElement>('.actions button, .actions-more button').click());

    assert.equal(calls.some((call) => call.method === 'POST'), false);

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('.confirm-field'), 'Не зона УК'));
    await screen.act(() => screen.find<HTMLButtonElement>('.confirm-do').click());

    assert.deepEqual(JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}'), {
      to: 'rejected',
      comment: 'Не зона УК',
    });

    await screen.unmount();
  });

  it('причина обязательна: без неё переход не отправить', async () => {
    const { screen, calls } = await openAs({
      '/api/requests/req-1/actions': { actions: ['needs_info'] },
      '/api/requests/req-1/transition': { ...REQUEST, status: 'needs_info' },
    });

    await screen.act(() => screen.find<HTMLButtonElement>('.actions button, .actions-more button').click());
    await screen.act(() => screen.find<HTMLButtonElement>('.confirm-do').click());

    assert.equal(calls.some((call) => call.method === 'POST'), false);

    await screen.unmount();
  });
});

describe('собрания собственников', () => {
  const POLL = {
    id: 'poll-1',
    kind: 'simple',
    kindTitle: 'Простое большинство',
    title: 'Ремонт подъездов',
    question: 'Утвердить смету на ремонт подъездов',
    opensAt: '2026-09-01T10:00:00Z',
    closesAt: '2026-09-15T10:00:00Z',
    open: true,
    turnout: 0.3333,
    quorum: false,
    passed: false,
    totalArea: 150,
    votedArea: 50,
    areaToQuorum: 25,
    quorumShare: 0.5,
    support: 0.3333,
    shares: { for: 0.3333, against: 0, abstain: 0 },
  };

  const INITIATIVE = {
    id: 'ini-1',
    kind: 'simple',
    kindTitle: 'Простое большинство',
    title: 'Шлагбаум во двор',
    question: 'Поставить шлагбаум на въезд со стороны улицы',
    createdAt: '2026-09-01T10:00:00Z',
    signatures: 2,
    share: 0.05,
    demandShare: 0.1,
    areaToDemand: 10,
    enough: false,
    mine: false,
    author: false,
  };

  it('предложение соседа собирает подписи и показывает, сколько не хватает', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/polls': [],
      'POST /api/initiatives/ini-1/support': { ...INITIATIVE, signatures: 3, mine: true, enough: true },
      '/api/initiatives': [INITIATIVE],
    });

    const screen = await render(createElement(PollsScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Шлагбаум во двор/);
    assert.match(screen.text, /Не хватает 10 м²/);

    const support = screen.findAll<HTMLButtonElement>('button').find((button) => button.textContent === 'Поддержать');

    await screen.act(() => {
      support?.click();
    });

    assert.equal(calls.some((call) => call.path === '/api/initiatives/ini-1/support' && call.method === 'POST'), true);

    await screen.unmount();
  });

  it('созвать собрание по предложению может только управляющая компания', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/polls': [], '/api/initiatives': [{ ...INITIATIVE, enough: true }] });

    const resident = await render(createElement(PollsScreen as never, { api } as never), bridge);

    assert.equal(/Созвать собрание/.test(resident.text), false);
    assert.match(resident.text, /вправе требовать собрания/);

    await resident.unmount();

    const staff = await render(createElement(PollsScreen as never, { api, canStart: true } as never), bridge);

    assert.match(staff.text, /Созвать собрание/);
    assert.equal(/Предложить соседям/.test(staff.text), false);
    assert.equal(/Поддержать/.test(staff.text), false);

    await staff.unmount();
  });

  it('показывает доли от площади дома и нехватку до кворума', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/polls': [POLL], '/api/initiatives': [] });

    const screen = await render(createElement(PollsScreen as never, { api } as never), bridge);

    assert.match(screen.text, /за 33%/);
    assert.match(screen.text, /Не хватает 25 м²/);

    assert.equal(screen.find<HTMLElement>('.quorum-fill').style.width, '33%');

    assert.equal(screen.find<HTMLElement>('.quorum-mark').style.left, '50%');
    assert.match(screen.text, /кворум/);

    await screen.unmount();
  });

  it('голос уходит выбранным вариантом', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'POST /api/polls': { ...POLL, myChoice: 'for', turnout: 0.5, quorum: true },
      '/api/polls': [POLL],
      '/api/initiatives': [],
    });

    const screen = await render(createElement(PollsScreen as never, { api } as never), bridge);

    await screen.act(() => (screen.findAll('.segments button')[1] as HTMLButtonElement).click());

    const post = calls.find((call) => call.method === 'POST');

    assert.equal(post?.path, '/api/polls/poll-1/vote');
    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { choice: 'against' });

    await screen.unmount();
  });

  it('завершённое собрание сообщает исход и не даёт голосовать', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/initiatives': [],
      '/api/polls': [
        { ...POLL, open: false, passed: true, quorum: true, turnout: 0.8, closedAt: '2026-09-16T10:00:00Z' },
      ],
    });

    const screen = await render(createElement(PollsScreen as never, { api } as never), bridge);

    assert.match(screen.text, /принято/);
    assert.equal(screen.findAll('.segments').length, 0);

    await screen.unmount();
  });

  it('протокол открывается по требованию', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/polls/poll-1/protocol': { text: 'Протокол общего собрания собственников' },
      '/api/initiatives': [],
      '/api/polls': [
        { ...POLL, open: false, passed: true, quorum: true, turnout: 0.8, closedAt: '2026-09-16T10:00:00Z' },
      ],
    });

    const opened: { title: string; text: string }[] = [];
    const screen = await render(
      createElement(PollsScreen as never, { api, onDocument: (title: string, text: string) => opened.push({ title, text }) } as never),
      bridge,
    );

    await screen.act(() => (screen.findAll('button.link')[0] as HTMLButtonElement).click());
    await screen.act(() => {});

    assert.equal(screen.findAll('.protocol').length, 0);
    assert.match(opened[0]?.title ?? '', /^Протокол: /);
    assert.equal(opened[0]?.text, 'Протокол общего собрания собственников');
    assert.equal(calls.some((call) => call.path === '/api/polls/poll-1/protocol'), true);

    await screen.unmount();
  });

  it('срок вышел, а итогов ещё нет: решения не показываем', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/polls': [{ ...POLL, open: false, passed: false, quorum: true }],
      '/api/initiatives': [],
    });

    const screen = await render(createElement(PollsScreen as never, { api } as never), bridge);

    assert.match(screen.text, /считаем/);
    assert.doesNotMatch(screen.text, /не принято/);
    assert.equal(screen.findAll('button.link').length, 0);

    await screen.unmount();
  });

  it('объявить собрание может только сотрудник', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/polls': [POLL], '/api/initiatives': [] });

    const forResident = await render(createElement(PollsScreen as never, { api } as never), bridge);
    assert.equal(/Объявить собрание/.test(forResident.text), false);
    await forResident.unmount();

    const forStaff = await render(createElement(PollsScreen as never, { api, canStart: true } as never), bridge);
    assert.match(forStaff.text, /Объявить собрание/);
    await forStaff.unmount();
  });

  it('собрание объявляется с порогом и сроком', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ 'POST /api/polls': POLL, '/api/polls': [], '/api/initiatives': [] });

    const screen = await render(createElement(PollsScreen as never, { api, canStart: true } as never), bridge);

    await screen.act(() => screen.find<HTMLButtonElement>('.publish, .card button').click());

    await screen.act(() => {
      typeInto(screen.find<HTMLInputElement>('#poll-title'), 'Ремонт подъездов');
      typeInto(screen.find<HTMLTextAreaElement>('#poll-question'), 'Утвердить смету');
    });

    await screen.act(() => {
      const kind = screen.find<HTMLSelectElement>('#poll-kind');
      kind.value = 'qualified';
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await screen.act(() => (screen.findAll('.card button')[0] as HTMLButtonElement).click());

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), {
      kind: 'qualified',
      title: 'Ремонт подъездов',
      question: 'Утвердить смету',
      days: 14,
      mode: 'meeting',
    });

    await screen.unmount();
  });
});

describe('показания счётчиков', () => {
  const METERS = [
    {
      id: 'cold-1',
      kind: 'cold_water',
      title: 'Холодная вода',
      unit: 'м³',
      decimals: 3,
      serial: 'ХВС-1',
      submittedThisMonth: false,
      lastConsumption: 3.2,
      lastValue: 120,
      lastAt: '2026-08-22T10:00:00Z',
    },
    {
      id: 'hot-1',
      kind: 'hot_water',
      title: 'Горячая вода',
      unit: 'м³',
      decimals: 3,
      serial: 'ГВС-1',
      submittedThisMonth: true,
      lastConsumption: 1.1,
      lastValue: 45,
      lastAt: '2026-09-22T10:00:00Z',
    },
  ];

  it('о поверке предупреждают заранее, а не отказом после ввода', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/meters': [{ ...METERS[0], verification: 'soon', verifiedUntil: '2026-10-17T00:00:00Z' }],
    });

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Проверить счётчик нужно до 17 октября/);
    assert.equal(screen.findAll('.field-row input').length, 1);

    await screen.unmount();
  });

  it('счётчик без поверки показание не просит: его всё равно не примут', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/meters': [{ ...METERS[0], verification: 'expired', verifiedUntil: '2026-06-01T00:00:00Z' }],
    });

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);

    assert.match(screen.text, /истёк срок проверки/);
    assert.match(screen.text, /Срок проверки истёк 1 июня/);
    assert.match(screen.text, /считают по средней норме/);
    assert.equal(screen.findAll('.field-row input').length, 0, 'поле обмануло бы: показание не примут');

    await screen.unmount();
  });

  it('показывает прошлое значение и сколько осталось подать', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/meters': METERS });

    const screen = await render(
      createElement(MetersScreen as never, { api, readingWindow: { fromDay: 20, toDay: 25 } } as never),
      bridge,
    );

    assert.match(screen.text, /до 25 числа/, 'жилец должен узнать срок приёма от продукта');
    assert.match(screen.text, /120 м³/, 'прошлое значение рядом с полем');
    assert.match(screen.text, /подано/, 'по горячей воде показание уже приняли');
    assert.equal(screen.findAll('.field-row input').length, 1, 'поле только там, где ещё ждут показание');

    await screen.unmount();
  });

  it('запятая в показании принимается', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'POST /api/meters': { value: 123.5, at: '2026-09-22T10:00:00Z', consumption: 3.5, spike: false },
      '/api/meters': METERS,
    });

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);

    await screen.act(() => typeInto(screen.find<HTMLInputElement>('.field-row input'), '123,5'));
    await screen.act(() => screen.find<HTMLButtonElement>('.reading-send').click());

    const post = calls.find((call) => call.method === 'POST');

    assert.equal(post?.path, '/api/meters/cold-1/readings');
    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { value: 123.5 });
    assert.match(screen.text, /Принято · расход 3,5 м³/);

    await screen.unmount();
  });

  it('резкий расход подсвечивается предупреждением', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      'POST /api/meters': { value: 200, at: '2026-09-22T10:00:00Z', consumption: 80, spike: true },
      '/api/meters': METERS,
    });

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);

    await screen.act(() => typeInto(screen.find<HTMLInputElement>('.field-row input'), '200'));
    await screen.act(() => screen.find<HTMLButtonElement>('.reading-send').click());

    assert.match(screen.text, /больше обычного/);
    assert.equal(screen.findAll('.error').length, 1);

    await screen.unmount();
  });

  it('нечисло до сервера не доходит', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/meters': METERS });

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);

    await screen.act(() => typeInto(screen.find<HTMLInputElement>('.field-row input'), 'сто'));
    await screen.act(() => screen.find<HTMLButtonElement>('.reading-send').click());

    assert.match(screen.text, /Отправьте показание цифрами/);
    assert.equal(calls.some((call) => call.method === 'POST'), false);
    assert.equal(screen.findAll('[role="alert"]').length, 1);

    await screen.unmount();
  });

  it('расход за месяцы показывается столбиками', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/meters/cold-1/history': [
        { at: '2026-07-22T10:00:00Z', value: 110, consumption: 0 },
        { at: '2026-08-22T10:00:00Z', value: 114, consumption: 4 },
        { at: '2026-09-22T10:00:00Z', value: 120, consumption: 6 },
      ],
      '/api/meters': METERS,
    });

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);
    await screen.act(() => {});

    const bars = screen.findAll('.spark-bar');

    assert.equal(bars.length, 2);
    assert.equal(bars.at(-1)?.className.includes('spark-bar-now'), true);
    assert.match(screen.find('.spark').getAttribute('aria-label') ?? '', /август 4 м³, сентябрь 6 м³/);

    await screen.unmount();
  });

  it('одного показания на график не хватает', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/meters/cold-1/history': [{ at: '2026-09-22T10:00:00Z', value: 120, consumption: 6 }],
      '/api/meters': METERS,
    });

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);
    await screen.act(() => {});

    assert.equal(screen.findAll('.spark').length, 0);

    await screen.unmount();
  });

  it('без счётчиков экран не пустой', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/meters': [] });

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Счётчиков нет/i);

    await screen.unmount();
  });
});

describe('сводка по дому', () => {
  const PERIOD = {
    from: '2026-08-04T10:00:00Z',
    to: '2026-09-03T10:00:00Z',
    created: 5,
    closed: 4,
    confirmed: 3,
    rejected: 1,
    mergedReports: 4,
    inTimeRate: 0.75,
    averageHours: 18.5,
    missed: 1,
  };

  const REPORT = {
    buildingId: 'b1',
    summary: { total: 5, open: 3, overdue: 2, confirmed: 1, rejected: 1, mergedReports: 4 },
    period: PERIOD,
    previous: { ...PERIOD, from: '2026-07-05T10:00:00Z', to: '2026-08-04T10:00:00Z', created: 9, inTimeRate: 0.5 },
    categories: [
      { category: 'plumbing', title: 'Водоснабжение и канализация', total: 3, overdue: 2, overdueRate: 0.667 },
      { category: 'cleaning', title: 'Уборка', total: 2, overdue: 0, overdueRate: 0 },
    ],
    assignees: [
      { assigneeId: 'tech-1', displayName: 'Сергей, мастер', completed: 4, reopened: 1, reopenRate: 0.25 },
      { assigneeId: 'tech-2', displayName: 'Пётр, мастер', completed: 2, reopened: 0, reopenRate: 0 },
    ],
    objects: [{ title: 'оборудование lift-1', requests: 4, reopened: 1 }],
    incidents: [{ requestId: 'req-1', number: 'Д15-2609-0001', title: 'подъезд 1, стояк 1', reporters: 3 }],
  };

  it('показывает числа и разделы, по которым принимают решения', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/report': REPORT });

    const screen = await render(createElement(ReportScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Склеено обращений/);
    assert.match(screen.text, /Дом сейчас/);
    assert.match(screen.text, /↓ было 9/);
    assert.match(screen.text, /75%/);
    assert.match(screen.text, /↑ было 50%/);
    assert.match(screen.text, /18\.5 ч/);
    assert.match(screen.text, /Авария: несколько обращений/);
    assert.match(screen.text, /сообщили 3/);
    assert.match(screen.text, /Водоснабжение и канализация2 из 367%/);
    assert.match(screen.text, /Сергей, мастер1 из 425%/);
    assert.match(screen.text, /оборудование lift-1обращений4/);

    await screen.unmount();
  });

  it('мастер без возвратов в список не попадает', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/report': REPORT });

    const screen = await render(createElement(ReportScreen as never, { api } as never), bridge);

    assert.equal(/Пётр, мастер/.test(screen.text), false);

    await screen.unmount();
  });

  it('доля закрытий с выездом появляется только там, где есть наклейки', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/report': {
        ...REPORT,
        assignees: [
          { assigneeId: 'tech-1', displayName: 'Сергей, мастер', completed: 4, reopened: 1, reopenRate: 0.25, onSite: 1 },
          { assigneeId: 'tech-2', displayName: 'Пётр, мастер', completed: 2, reopened: 0, reopenRate: 0, onSite: 2 },
        ],
      },
    });

    const screen = await render(createElement(ReportScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Закрыто с выездом/);
    assert.match(screen.text, /Сергей, мастер1 из 425%.*Пётр, мастер2 из 2100%/);

    await screen.unmount();
  });

  it('в спокойном доме пустые разделы не показываются', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/report': {
        ...REPORT,
        summary: { total: 2, open: 1, overdue: 0, confirmed: 1, rejected: 0, mergedReports: 0 },
        categories: [{ category: 'cleaning', title: 'Уборка', total: 2, overdue: 0, overdueRate: 0 }],
        assignees: [],
        objects: [],
        incidents: [],
      },
    });

    const screen = await render(createElement(ReportScreen as never, { api } as never), bridge);

    assert.equal(/Не укладываемся/.test(screen.text), false);
    assert.equal(/Ломается чаще прочего/.test(screen.text), false);
    assert.match(screen.text, /Открыто/);

    await screen.unmount();
  });

  it('период переключается и уходит в запрос', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/report': REPORT });

    const screen = await render(createElement(ReportScreen as never, { api } as never), bridge);

    assert.equal(calls[0]?.path, '/api/report?days=30');

    const quarter = screen.findAll('button').find((button) => button.textContent === 'Квартал');
    assert.ok(quarter, 'нет кнопки «Квартал»');

    await screen.act(() => (quarter as HTMLButtonElement).click());

    assert.ok(
      calls.some((call) => call.path === '/api/report?days=90'),
      'период не дошёл до сервера',
    );
    assert.match(screen.text, /Не укладываемся за квартал/);

    await screen.unmount();
  });
});

describe('объявления', () => {
  const ANNOUNCEMENT = {
    id: 'ann-1',
    title: 'Отключение воды',
    body: 'Завтра с 9 до 14',
    createdAt: '2026-09-03T10:00:00Z',
    audience: 'подъезд 1, стояк 2',
    recipients: 4,
  };

  it('показывает адресата словами и дату публикации', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/announcements': [ANNOUNCEMENT] });

    const screen = await render(createElement(AnnouncementsScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Отключение воды/);
    assert.match(screen.text, /подъезд 1, стояк 2/);
    assert.match(screen.text, /3 сент/);
    assert.equal(/4 кварт/.test(screen.text), false, 'жильцу охват рассылки не нужен');

    await screen.unmount();
  });

  it('жилец публиковать не может', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/announcements': [ANNOUNCEMENT] });

    const screen = await render(createElement(AnnouncementsScreen as never, { api } as never), bridge);

    assert.equal(/Опубликовать объявление/.test(screen.text), false);

    await screen.unmount();
  });

  it('сотрудник публикует объявление и сразу видит охват', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'POST /api/announcements': { id: 'ann-2', audience: 'подъезд 1, стояк 2', recipients: 4 },
      '/api/announcements': [ANNOUNCEMENT],
    });

    const screen = await render(
      createElement(AnnouncementsScreen as never, { api, showReach: true } as never),
      bridge,
    );

    await screen.act(() => screen.find<HTMLButtonElement>('.publish, .card button').click());

    await screen.act(() => {
      typeInto(screen.find<HTMLInputElement>('#title'), 'Отключение воды');
      typeInto(screen.find<HTMLTextAreaElement>('#body'), 'Завтра с 9 до 14');
      typeInto(screen.find<HTMLInputElement>('#entrance'), '1');
      typeInto(screen.find<HTMLInputElement>('#riser'), '2');
    });

    await screen.act(() => screen.find<HTMLFormElement>('form').requestSubmit());

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), {
      title: 'Отключение воды',
      body: 'Завтра с 9 до 14',
      entrance: 1,
      riser: 2,
    });

    assert.match(screen.text, /Отправлено: подъезд 1, стояк 2 · 4 квартир/);

    await screen.unmount();
  });

  it('стояк без подъезда выбрать нельзя', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/announcements': [ANNOUNCEMENT] });

    const screen = await render(
      createElement(AnnouncementsScreen as never, { api, showReach: true } as never),
      bridge,
    );

    await screen.act(() => screen.find<HTMLButtonElement>('.publish, .card button').click());

    assert.equal(screen.find<HTMLInputElement>('#riser').disabled, true);

    await screen.unmount();
  });

  it('пустое объявление до сервера не доходит', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/announcements': [ANNOUNCEMENT] });

    const screen = await render(
      createElement(AnnouncementsScreen as never, { api, showReach: true } as never),
      bridge,
    );

    await screen.act(() => screen.find<HTMLButtonElement>('.publish, .card button').click());
    await screen.act(() => screen.find<HTMLFormElement>('form').requestSubmit());

    assert.match(screen.text, /Заполните заголовок и текст/);
    assert.equal(calls.some((call) => call.method === 'POST'), false);

    await screen.unmount();
  });

  it('отказ сервера показывается словами сервера', async () => {
    const { bridge } = createMockBridge();
    const { fetchStub, calls } = stubFetch({ '/api/announcements': [ANNOUNCEMENT] });
    let attempt = 0;

    const failing: typeof fetchStub = (input, init) => {
      attempt += 1;

      if (init?.method === 'POST' && attempt > 0) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'forbidden', message: 'Объявления публикует управляющая компания' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }

      return fetchStub(input, init);
    };

    const api = new DomovoyApi({ baseUrl: 'http://api.test', fetch: failing });
    const screen = await render(
      createElement(AnnouncementsScreen as never, { api, showReach: true } as never),
      bridge,
    );

    await screen.act(() => screen.find<HTMLButtonElement>('.publish, .card button').click());
    await screen.act(() => {
      typeInto(screen.find<HTMLInputElement>('#title'), 'Собрание');
      typeInto(screen.find<HTMLTextAreaElement>('#body'), 'В четверг');
    });
    await screen.act(() => screen.find<HTMLFormElement>('form').requestSubmit());

    assert.match(screen.text, /Объявления публикует управляющая компания/);
    assert.ok(calls.length > 0);

    await screen.unmount();
  });

  it('плановые работы уходят вместе с объявлением', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/announcements': [ANNOUNCEMENT] });

    const screen = await render(
      createElement(AnnouncementsScreen as never, { api, showReach: true } as never),
      bridge,
    );

    await screen.act(() => screen.find<HTMLButtonElement>('.publish, .card button').click());
    await screen.act(() => {
      typeInto(screen.find<HTMLInputElement>('#title'), 'Замена задвижки');
      typeInto(screen.find<HTMLTextAreaElement>('#body'), 'Отключение воды на время работ');
    });

    assert.equal(screen.findAll('#works-until').length, 0);

    await screen.act(() => {
      const kind = screen.find<HTMLSelectElement>('#works');
      Object.getOwnPropertyDescriptor(globalThis.HTMLSelectElement.prototype, 'value')?.set?.call(kind, 'plumbing');
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await screen.act(() => {
      typeInto(screen.find<HTMLInputElement>('#works-from'), '2026-09-03T09:00');
      typeInto(screen.find<HTMLInputElement>('#works-until'), '2026-09-03T14:00');
    });

    await screen.act(() => screen.find<HTMLFormElement>('form').requestSubmit());

    const post = calls.find((call) => call.method === 'POST');
    const sent = JSON.parse(post?.body ?? '{}') as { works?: { category: string; from: string; until: string } };

    assert.equal(sent.works?.category, 'plumbing');
    assert.equal(new Date(sent.works?.until ?? '').getTime(), new Date('2026-09-03T14:00').getTime());

    await screen.unmount();
  });

  it('плановые работы без срока окончания до сервера не доходят', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/announcements': [ANNOUNCEMENT] });

    const screen = await render(
      createElement(AnnouncementsScreen as never, { api, showReach: true } as never),
      bridge,
    );

    await screen.act(() => screen.find<HTMLButtonElement>('.publish, .card button').click());
    await screen.act(() => {
      typeInto(screen.find<HTMLInputElement>('#title'), 'Замена задвижки');
      typeInto(screen.find<HTMLTextAreaElement>('#body'), 'Отключение воды');
    });
    await screen.act(() => {
      const kind = screen.find<HTMLSelectElement>('#works');
      Object.getOwnPropertyDescriptor(globalThis.HTMLSelectElement.prototype, 'value')?.set?.call(kind, 'plumbing');
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await screen.act(() => screen.find<HTMLFormElement>('form').requestSubmit());

    assert.match(screen.text, /до какого момента идут работы/);
    assert.equal(calls.some((call) => call.method === 'POST'), false);

    await screen.unmount();
  });

  it('идущие работы отличаются от объявленных и от законченных', async () => {
    const { bridge } = createMockBridge();
    const hour = 3600_000;

    const withWorks = (from: number, until: number) => ({
      ...ANNOUNCEMENT,
      works: {
        category: 'plumbing',
        from: new Date(Date.now() + from).toISOString(),
        until: new Date(Date.now() + until).toISOString(),
      },
    });

    const cases: [string, RegExp][] = [
      ['идут', /идут до /],
      ['объявлены', /с .* до /],
      ['закончились', /закончили /],
    ];

    const windows: Record<string, [number, number]> = {
      идут: [-hour, hour],
      объявлены: [hour, 2 * hour],
      закончились: [-2 * hour, -hour],
    };

    for (const [name, pattern] of cases) {
      const [from, until] = windows[name]!;
      const { api } = apiWith({ '/api/announcements': [withWorks(from, until)] });
      const screen = await render(createElement(AnnouncementsScreen as never, { api } as never), bridge);

      assert.match(screen.text, pattern, `состояние «${name}» не показано`);

      await screen.unmount();
    }
  });

  it('сотруднику видно, до скольких квартир дошло объявление', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/announcements': [ANNOUNCEMENT] });

    const screen = await render(
      createElement(AnnouncementsScreen as never, { api, showReach: true } as never),
      bridge,
    );

    assert.match(screen.text, /4 квартир/);

    await screen.unmount();
  });
});

/** Отказ сервера и пустой ответ, разные вещи. */
describe('привязка квартиры', () => {
  it('тому, кто квитанции не нашёл, экран даёт телефон и поддержку', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/house/contacts': {
        buildingId: 'b1',
        address: 'ул. Ленина, 15',
        service: { phone: '+7 900 120-45-00', hours: 'пн-пт 9:00-18:00' },
      },
    });
    let toSupport = 0;

    const screen = await render(
      createElement(
        Toasts as never,
        null,
        createElement(BindApartmentScreen as never, {
          api,
          onBound: () => undefined,
          onSupport: () => (toSupport += 1),
        } as never),
      ),
      bridge,
    );
    await screen.act(() => {});

    assert.match(screen.text, /Не нашли код/);
    assert.match(screen.text, /\+7 900 120-45-00/);

    await screen.act(() => tap(screen, 'Написать в поддержку'));

    assert.equal(toSupport, 1);

    await screen.unmount();
  });

  it('заполнитель поля не выглядит набранным кодом', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({});

    const screen = await render(
      createElement(
        Toasts as never,
        null,
        createElement(BindApartmentScreen as never, { api, onBound: () => undefined } as never),
      ),
      bridge,
    );

    const field = screen.find<HTMLInputElement>('#apartment-code');

    assert.equal(field.value, '');
    assert.doesNotMatch(field.getAttribute('placeholder') ?? '', /^[A-Z]{4}\d{4}$/);

    await screen.unmount();
  });

  it('код из квитанции уходит на сервер и открывает остальное', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/me/apartment': { apartmentId: 'apt-12', number: 12, alreadyBound: false },
    });
    let bound = 0;

    const screen = await render(
      createElement(BindApartmentScreen as never, { api, onBound: () => (bound += 1) } as never),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLInputElement>('#apartment-code'), '  kvmr4783  '));
    await screen.act(() => screen.find<HTMLButtonElement>('button').click());

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { code: 'KVMR4783' }, 'набранное строчными уходит как код');
    assert.equal(bound, 1);

    await screen.unmount();
  });

  it('пустой код до сервера не доходит', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({});
    let bound = 0;

    const screen = await render(
      createElement(
        Toasts as never,
        null,
        createElement(BindApartmentScreen as never, { api, onBound: () => (bound += 1) } as never),
      ),
      bridge,
    );

    await screen.act(() => screen.find<HTMLButtonElement>('button').click());

    assert.match(screen.text, /Введите код из квитанции/);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
    assert.equal(bound, 0);

    await screen.unmount();
  });

  it('чужой код объясняется словами сервера', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(400, 'apartment_unknown', 'Такой квартиры нет в этом доме');
    let bound = 0;

    const screen = await render(
      createElement(
        Toasts as never,
        null,
        createElement(BindApartmentScreen as never, { api, onBound: () => (bound += 1) } as never),
      ),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLInputElement>('#apartment-code'), 'apt_999'));
    await screen.act(() => screen.find<HTMLButtonElement>('button').click());

    assert.match(screen.text, /Такой квартиры нет в этом доме/);
    assert.equal(bound, 0);

    await screen.unmount();
  });

});

describe('жильцы без квартиры', () => {
  it('сотрудник привязывает жильца выбором квартиры', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/residents/unbound': [{ id: 'res-7', displayName: 'Мария' }],
      '/api/residents': [],
      '/api/residents/res-7/apartment': { apartmentId: 'apt-2', number: 2, alreadyBound: false },
      '/api/apartments': [{ id: 'apt-2', number: 2, entrance: 1, riser: 2 }],
    });

    const screen = await render(createElement(ResidentsScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Мария/);

    await screen.act(() => {
      const select = screen.find<HTMLSelectElement>('select');
      Object.getOwnPropertyDescriptor(globalThis.HTMLSelectElement.prototype, 'value')?.set?.call(select, 'apt-2');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const bind = screen.findAll('button').find((button) => button.textContent === 'Привязать');
    assert.ok(bind, 'нет кнопки «привязать»');

    await screen.act(() => (bind as HTMLButtonElement).click());

    const post = calls.find((call) => call.method === 'POST');

    assert.equal(post?.path, '/api/residents/res-7/apartment');
    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { apartmentId: 'apt-2' });

    await screen.unmount();
  });

  it('квартира стоит в строке человека, а без неё так и написано', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/residents/unbound': [],
      '/api/residents': [
        { id: 'res-1', displayName: 'Мария', role: 'resident', apartmentNumber: 1 },
        { id: 'res-2', displayName: 'Гость Петров', role: 'resident' },
      ],
      '/api/apartments': [],
    });

    const screen = await render(createElement(ResidentsScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Марияжилец · кв\. 1/);
    assert.match(screen.text, /Гость Петровжилец · квартира не привязана/);

    await screen.unmount();
  });

  it('людей в доме сотни, поэтому их ищут по имени и квартире', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/residents/unbound': [],
      '/api/residents': Array.from({ length: 24 }, (_item, index) => ({
        id: `res-${index}`,
        displayName: index === 3 ? 'Мария' : `Жилец ${index}`,
        role: 'resident',
        apartmentNumber: index + 1,
      })),
      '/api/apartments': [],
    });

    const screen = await render(createElement(ResidentsScreen as never, { api } as never), bridge);

    const search = screen.find<HTMLInputElement>('#people-search');

    assert.ok(search, 'поиска по людям нет');

    await screen.act(() => typeInto(search, 'Мария'));

    assert.match(screen.text, /Мария/);
    assert.doesNotMatch(screen.text, /Жилец 5/);

    await screen.unmount();
  });

  it('без выбранной квартиры на сервер не ходим', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/residents/unbound': [{ id: 'res-7', displayName: 'Мария' }],
      '/api/residents': [],
      '/api/apartments': [{ id: 'apt-2', number: 2, entrance: 1, riser: 2 }],
    });

    const screen = await render(createElement(ResidentsScreen as never, { api } as never), bridge);

    const bind = screen.findAll('button').find((button) => button.textContent === 'Привязать');

    await screen.act(() => (bind as HTMLButtonElement).click());

    assert.match(screen.text, /Выберите квартиру/);
    assert.equal(calls.some((call) => call.method === 'POST'), false);

    await screen.unmount();
  });

  it('старшего по подъезду не назначают, а ставят на голосование', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/residents/unbound': [],
      '/api/residents': [{ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentNumber: 1 }],
      '/api/apartments': [],
      'POST /api/polls/elder': { id: 'poll-9', title: 'Старший по подъезду 1' },
    });

    const screen = await render(
      createElement(ResidentsScreen as never, { api, canAssignRoles: true } as never),
      bridge,
    );

    const row = screen
      .findAll('[class*=CellSimple]')
      .find((node) => (node.textContent ?? '').includes('Мария')) as HTMLElement;

    await screen.act(() => row.click());

    const elect = screen
      .findAll('.roles button')
      .find((button) => button.textContent === 'В старшие подъезда') as HTMLButtonElement;

    await screen.act(() => elect.click());

    // Выборы затрагивают весь подъезд: сначала подтверждение, потом запрос.
    const confirm = screen
      .findAll('button')
      .find((button) => button.textContent === 'Объявить выборы') as HTMLButtonElement;

    await screen.act(() => confirm.click());

    const post = calls.find((call) => call.path === '/api/polls/elder');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { candidateId: 'res-1', days: 14 });

    await screen.unmount();
  });

  it('управляющий меняет роль кнопкой, диспетчер только смотрит', async () => {
    const { bridge } = createMockBridge();
    const people = [
      { id: 'res-1', displayName: 'Мария', role: 'resident', apartmentNumber: 1 },
      { id: 'disp-1', displayName: 'Ольга', role: 'dispatcher' },
    ];

    const forManager = apiWith({
      '/api/residents/unbound': [],
      '/api/residents/res-1/role': { id: 'res-1', displayName: 'Мария', role: 'technician' },
      '/api/residents': people,
      '/api/apartments': [],
    });

    const screen = await render(
      createElement(ResidentsScreen as never, { api: forManager.api, canAssignRoles: true } as never),
      bridge,
    );

    assert.match(screen.text, /Мария/);
    assert.match(screen.text, /Ольга/);

    const row = screen
      .findAll('[class*=CellSimple]')
      .find((node) => (node.textContent ?? '').includes('Мария')) as HTMLElement;

    await screen.act(() => row.click());

    const promote = screen
      .findAll('.roles button')
      .find((button) => button.textContent === 'мастер') as HTMLButtonElement;

    await screen.act(() => promote.click());

    const post = forManager.calls.find((call) => call.method === 'POST');

    assert.equal(post?.path, '/api/residents/res-1/role');
    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { role: 'technician' });

    await screen.unmount();

    const forDispatcher = apiWith({ '/api/residents/unbound': [], '/api/residents': people, '/api/apartments': [] });
    const second = await render(
      createElement(ResidentsScreen as never, { api: forDispatcher.api } as never),
      bridge,
    );

    assert.equal(second.findAll('.roles button').length, 0, 'диспетчеру роли не раздают');

    assert.equal(second.findAll('.duty input').length, 1);

    await second.unmount();
  });

  it('дежурство ставится одной кнопкой и уходит на сервер', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/residents/unbound': [],
      '/api/residents/disp-1/duty': { id: 'disp-1', displayName: 'Ольга', role: 'dispatcher', onDuty: true },
      '/api/residents': [{ id: 'disp-1', displayName: 'Ольга', role: 'dispatcher' }],
      '/api/apartments': [],
    });

    const screen = await render(createElement(ResidentsScreen as never, { api } as never), bridge);

    const toggle = screen.find<HTMLInputElement>('.duty input');

    await screen.act(() => toggle.click());

    const post = calls.find((call) => call.method === 'POST');

    assert.equal(post?.path, '/api/residents/disp-1/duty');
    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { onDuty: true });

    await screen.unmount();
  });

  it('жильцу дежурство не предлагают', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/residents/unbound': [],
      '/api/residents': [{ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentNumber: 1 }],
      '/api/apartments': [],
    });

    const screen = await render(createElement(ResidentsScreen as never, { api } as never), bridge);

    assert.doesNotMatch(screen.text, /дежурств/i);

    await screen.unmount();
  });

  it('когда привязаны все, раздел не занимает экран пустотой', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/residents/unbound': [],
      '/api/residents': [{ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentNumber: 1 }],
      '/api/apartments': [],
    });

    const screen = await render(createElement(ResidentsScreen as never, { api } as never), bridge);

    assert.doesNotMatch(screen.text, /без квартиры/i);
    assert.match(screen.text, /Мария/);

    await screen.unmount();
  });
});

describe('отказ вместо пустоты', () => {
  it('счётчики: причина отказа вместо «счётчиков нет»', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(409, 'apartment_unknown', 'Сначала привяжите квартиру');

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Сначала привяжите квартиру/);
    assert.doesNotMatch(screen.text, /Счётчиков нет/);

    await screen.unmount();
  });

  it('собрания: причина отказа вместо «собраний нет»', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(409, 'apartment_unknown', 'Сначала привяжите квартиру');

    const screen = await render(createElement(PollsScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Сначала привяжите квартиру/);
    assert.doesNotMatch(screen.text, /Собраний нет/);

    await screen.unmount();
  });

  it('мастер закрывает наряд с экрана заявки', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests/req-1/actions': { actions: ['done'] },
      '/api/requests/req-1/transition': { ...REQUEST, status: 'done' },
      '/api/requests/req-1': { ...REQUEST, status: 'in_progress' },
    });

    const screen = await render(
      createElement(RequestScreen as never, { api, id: 'req-1', staff: true } as never),
      bridge,
    );

    const scan = screen.findAll('button').find((button) => (button.textContent ?? '').includes('Сканировать код'));

    assert.ok(scan, 'у наряда нет сканирования кода');

    await screen.act(() => (scan as HTMLButtonElement).click());

    assert.match(screen.text, /Что сделали/, 'перед сдачей спрашивают отметку о работе');
    assert.equal(
      calls.find((call) => call.path.includes('/transition')),
      undefined,
      'отметка уходит вместе с работой, а не после неё',
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('.confirm-field'), 'Заменил лампу'));
    await screen.act(() => screen.find<HTMLButtonElement>('.confirm-do').click());

    const post = calls.find((call) => call.path.includes('/transition'));

    assert.equal(JSON.parse(post?.body ?? '{}').to, 'done');
    assert.equal(JSON.parse(post?.body ?? '{}').comment, 'Заменил лампу');
    assert.ok(JSON.parse(post?.body ?? '{}').provedBy, 'закрытие ушло без подтверждения на месте');

    await screen.unmount();
  });

  it('содранная наклейка закрыть наряд не мешает, но подтверждения не даёт', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests/req-1/actions': { actions: ['done'] },
      '/api/requests/req-1/transition': { ...REQUEST, status: 'done' },
      '/api/requests/req-1': { ...REQUEST, status: 'in_progress' },
    });

    const screen = await render(
      createElement(RequestScreen as never, { api, id: 'req-1', staff: true } as never),
      bridge,
    );

    await screen.act(() => tap(screen, 'Сдать без кода'));
    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('.confirm-field'), 'Подтянул кран'));
    await screen.act(() => screen.find<HTMLButtonElement>('.confirm-do').click());

    const post = calls.find((call) => call.path.includes('/transition'));

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { to: 'done', comment: 'Подтянул кран' });

    await screen.unmount();
  });

  it('без отметки о сделанном работу не сдать', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests/req-1/actions': { actions: ['done'] },
      '/api/requests/req-1/transition': { ...REQUEST, status: 'done' },
      '/api/requests/req-1': { ...REQUEST, status: 'in_progress' },
    });

    const screen = await render(
      createElement(RequestScreen as never, { api, id: 'req-1', staff: true } as never),
      bridge,
    );

    await screen.act(() => tap(screen, 'Сдать без кода'));

    assert.equal(screen.find<HTMLButtonElement>('.confirm-do').disabled, true);

    await screen.act(() => screen.find<HTMLButtonElement>('.confirm-do').click());

    assert.equal(
      calls.find((call) => call.path.includes('/transition')),
      undefined,
    );

    await screen.unmount();
  });

  it('жильцу действий сотрудника не показывают', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests/req-1/actions': { actions: ['withdrawn'] },
      '/api/requests/req-1': { ...REQUEST, status: 'in_progress' },
    });

    const screen = await render(createElement(RequestScreen as never, { api, id: 'req-1' } as never), bridge);

    assert.equal(
      screen.findAll('button').some((button) => button.textContent === 'Выполнена'),
      false,
    );

    assert.equal(
      screen.findAll('button').some((button) => button.textContent === 'Снять'),
      true,
    );

    await screen.unmount();
  });

  it('жилец видит, кто отвечает и что обращение передано', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests/req-1/actions': { actions: [] },
      '/api/requests/req-1/responsibility': {
        kind: 'management',
        title: 'Управляющая организация',
        basis: 'Общее имущество дома: ч. 1 ст. 36 ЖК РФ',
        targets: [],
        handoffs: [
          {
            id: 'h-1',
            requestId: 'req-1',
            to: 'resource',
            organization: 'Водоканал',
            channel: 'email',
            status: 'sent',
            statusTitle: 'передано',
            dueAt: '2026-09-03T12:00:00Z',
            basis: 'п. 108 Правил № 354',
            overdue: false,
            createdAt: '2026-09-03T10:00:00Z',
            externalId: 'MOCK-0001',
          },
        ],
      },
      '/api/requests/req-1': REQUEST,
    });

    const screen = await render(createElement(RequestScreen as never, { api, id: 'req-1' } as never), bridge);

    assert.match(screen.text, /Кто отвечает/);
    assert.match(screen.text, /ст\. 36 ЖК РФ/);
    assert.match(screen.text, /Водоканал/);
    assert.match(screen.text, /MOCK-0001/);
    assert.match(screen.text, /Правил № 354/);

    assert.equal(
      screen.findAll('button').some((button) => (button.textContent ?? '').startsWith('Передать')),
      false,
      'жильцу передачи не предлагают',
    );

    await screen.unmount();
  });

  it('смена передаёт обращение организации дома одной кнопкой', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests/req-1/actions': { actions: [] },
      '/api/staff': [],
      '/api/requests/req-1/responsibility': {
        kind: 'management',
        title: 'Управляющая организация',
        basis: 'Общее имущество дома: ч. 1 ст. 36 ЖК РФ',
        targets: [{ to: 'resource', organization: 'Водоканал', basis: 'п. 108 Правил № 354' }],
        handoffs: [],
      },
      '/api/requests/req-1': REQUEST,
    });

    const screen = await render(
      createElement(RequestScreen as never, { api, id: 'req-1', staff: true } as never),
      bridge,
    );

    const pass = screen.findAll('button').find((button) => (button.textContent ?? '').startsWith('Передать'));

    assert.ok(pass, 'кнопки передачи нет');
    await screen.act(() => (pass as HTMLButtonElement).click());
    await screen.act(() => {});

    const sent = calls.find((call) => call.path === '/api/requests/req-1/handoff');

    assert.equal(sent?.method, 'POST');
    assert.deepEqual(JSON.parse(sent?.body ?? '{}'), { to: 'resource' });

    await screen.unmount();
  });

  it('пустой список мастера не зовёт его заводить заявку', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/requests': [] });

    const screen = await render(createElement(RequestListScreen as never, { api, staff: true } as never), bridge);

    assert.match(screen.text, /Нарядов нет/);
    assert.doesNotMatch(screen.text, /Отсканируйте код/);

    await screen.unmount();
  });

  it('мои заявки: отказ не выглядит как отсутствие заявок', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(401, 'unauthorized', 'Сессия истекла');

    const screen = await render(createElement(RequestListScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Сессия истекла/);
    assert.doesNotMatch(screen.text, /Заявок пока нет/);

    await screen.unmount();
  });

  it('очередь: отказ не выглядит как пустая смена', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(403, 'forbidden', 'Очередь доступна сотрудникам');

    const screen = await render(createElement(QueueScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Очередь доступна сотрудникам/);
    assert.doesNotMatch(screen.text, /Очередь пуста/);

    await screen.unmount();
  });

  it('сводка: отказ по правам объясняется словами сервера', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(403, 'forbidden', 'Сводка доступна управляющей компании');

    const screen = await render(createElement(ReportScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Сводка доступна управляющей компании/);

    await screen.unmount();
  });

  it('объявления: отказ виден рядом со списком', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(500, 'internal', 'Хранилище недоступно');

    const screen = await render(createElement(AnnouncementsScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Хранилище недоступно/);
    assert.doesNotMatch(screen.text, /Объявлений нет/);

    await screen.unmount();
  });

  it('повтор загрузки доступен прямо с экрана отказа', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiRefusing(500, 'internal', 'Хранилище недоступно');

    const screen = await render(createElement(RequestListScreen as never, { api } as never), bridge);

    const before = calls.length;
    await screen.act(() => screen.find<HTMLButtonElement>('button').click());

    assert.ok(calls.length > before, 'повтор не сходил на сервер');

    await screen.unmount();
  });

  it('отказ по правилу повторять не предлагают', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(409, 'apartment_unknown', 'Сначала привяжите квартиру');

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Сначала привяжите квартиру/);
    assert.equal(screen.findAll('button').length, 0, 'повторять нечего');

    await screen.unmount();
  });

  it('пропавшая сеть даёт кнопку повтора: она проходит сама', async () => {
    const { bridge } = createMockBridge();
    const fetchStub = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));
    const api = new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub });

    const screen = await render(createElement(MetersScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Нет связи с сервером/);
    assert.equal(screen.find<HTMLButtonElement>('button')?.textContent, 'Повторить');

    await screen.unmount();
  });
});

/** Кладёт выбранный файл в поле так, как это делает браузер. */
const pick = (field: HTMLInputElement, file: File): void => {
  Object.defineProperty(field, 'files', { configurable: true, value: [file] });
  field.dispatchEvent(new Event('change', { bubbles: true }));
};

const jpeg = (name = 'кран.jpg'): File =>
  new File([Uint8Array.from([0xff, 0xd8, 0xff, 0x01])], name, { type: 'image/jpeg' });

describe('код с наклейки', () => {
  it('вынимается из ссылки платформы', () => {
    assert.equal(codeFromScan('https://max.ru/domovoy_bot?startapp=eqp_dom15_lift-1'), 'eqp_dom15_lift-1');
  });

  it('годится и напечатанный кодом, без ссылки', () => {
    assert.equal(codeFromScan('  ent_b1_2  '), 'ent_b1_2');
  });

  it('чужая ссылка кодом объекта не притворяется', () => {
    assert.equal(codeFromScan('https://example.com/акция'), undefined);
  });

  it('пустой результат сканирования, не код', () => {
    assert.equal(codeFromScan('   '), undefined);
  });
});

describe('первый вход и помощник', () => {
  /** Отметка о показе живёт и в браузере: между проверками её снимаем. */
  beforeEach(() => globalThis.localStorage.clear());

  it('тур подсвечивает разделы по очереди и заканчивается', async () => {
    const { bridge } = createMockBridge();
    let done = 0;

    const anchor = globalThis.document.createElement('button');

    anchor.setAttribute('data-guide', 'tab-list');
    anchor.textContent = 'Заявки';
    globalThis.document.body.appendChild(anchor);

    const steps = [
      { anchor: 'tab-list', title: 'Заявки', hint: '' , text: 'Ваши обращения и сроки' },
      { anchor: 'assistant', title: 'Помощник', text: 'Спросите словами, что нужно' },
    ];

    const screen = await render(createElement(Tour as never, { steps, onDone: () => (done += 1) } as never), bridge);

    assert.match(screen.text, /Ваши обращения и сроки/);
    assert.match(screen.text, /1 из 2/);

    await screen.act(() => tap(screen, 'Дальше'));

    assert.match(screen.text, /Спросите словами/);

    await screen.act(() => tap(screen, 'Понятно'));

    assert.equal(done, 1, 'тур не сообщил, что закончился');

    anchor.remove();
    await screen.unmount();
  });

  it('тур пропускается кнопкой', async () => {
    const { bridge } = createMockBridge();
    let done = 0;

    const screen = await render(
      createElement(Tour as never, {
        steps: [{ anchor: 'tab-list', title: 'Заявки', text: 'Ваши обращения' }],
        onDone: () => (done += 1),
      } as never),
      bridge,
    );

    await screen.act(() => tap(screen, 'Пропустить'));

    assert.equal(done, 1);

    await screen.unmount();
  });

  it('уточнение адреса приходит кнопками и ставит адрес заявке', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests/req-1/clarify': {
        question: 'В какой квартире течёт?',
        options: [
          { label: 'Квартира 1', startParam: 'apt_apt-1' },
          { label: 'Квартира 5', startParam: 'apt_apt-5' },
        ],
      },
      '/api/requests/req-1/target': REQUEST,
      '/api/requests/req-1/actions': { actions: [] },
      '/api/requests/req-1': REQUEST,
    });

    const screen = await render(createElement(RequestScreen as never, { api, id: 'req-1' } as never), bridge);

    assert.match(screen.text, /В какой квартире течёт/);

    const button = screen.findAll('button').find((item) => item.textContent === 'Квартира 5');

    assert.ok(button, 'вариантов кнопками нет');
    await screen.act(() => (button as HTMLButtonElement).click());
    await screen.act(() => {});

    const sent = calls.find((call) => call.path === '/api/requests/req-1/target');

    assert.equal(sent?.method, 'POST');
    assert.deepEqual(JSON.parse(sent?.body ?? '{}'), { startParam: 'apt_apt-5' });
    assert.doesNotMatch(screen.text, /В какой квартире течёт/, 'вопрос остался после ответа');

    await screen.unmount();
  });

  it('помощник отвечает и даёт переход в раздел', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'GET /api/assistant': { starters: ['Где передать показания?', 'Что с моей заявкой?'] },
      '/api/assistant': { answer: 'Откройте «Оплата»: там показания и квитанция.', screen: 'meters', by: 'model' },
    });
    const went: string[] = [];

    const screen = await render(
      createElement(Assistant as never, {
        api,
        onGo: (target: string) => went.push(target),
        onClose: () => undefined,
      } as never),
      bridge,
    );

    // Подсказки приходят с сервера: у смены они свои, у жильца свои.
    await screen.act(() => tap(screen, 'Где передать показания?'));
    await screen.act(() => {});

    const asked = calls.find((call) => call.path === '/api/assistant' && call.method === 'POST');

    assert.equal(asked?.method, 'POST');
    assert.deepEqual(JSON.parse(asked?.body ?? '{}'), { question: 'Где передать показания?' });
    assert.match(screen.text, /Откройте «Оплата»/);
    assert.match(screen.text, /Где передать показания\?/, 'вопрос не остался в разговоре');

    await screen.act(() => tap(screen, 'Открыть'));

    assert.deepEqual(went, ['meters']);

    await screen.unmount();
  });

  it('отказ помощника виден человеку, а не теряется', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(500, 'internal', 'Служба недоступна');

    const screen = await render(
      createElement(Assistant as never, { api, onGo: () => undefined, onClose: () => undefined } as never),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('.composer-field'), 'Что с моей заявкой?'));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());
    await screen.act(() => {});

    assert.equal(screen.findAll('[role="alert"]').length, 1);

    await screen.unmount();
  });

  it('без подсказок с сервера помощник всё равно спрашивает словами', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(500, 'internal', 'Служба недоступна');

    const screen = await render(
      createElement(Assistant as never, { api, onGo: () => undefined, onClose: () => undefined } as never),
      bridge,
    );

    assert.equal(screen.findAll('.assistant-starters .chip').length, 0);
    assert.ok(screen.find('.composer-field'), 'поле вопроса пропало вместе с подсказками');

    await screen.unmount();
  });
});

describe('возможности клиента MAX', () => {
  it('код с наклейки читается камерой и определяет объект', async () => {
    const { bridge } = createMockBridge({ codeReaderResult: 'https://max.ru/domovoy_bot?startapp=ent_b1_1' });
    const { api, calls } = apiWith({
      '/api/context': { target: 'подъезд 1', audience: 'подъезд 1', buildingId: 'b1' },
      '/api/objects': EMPTY_PASSPORT,
    });

    const screen = await render(
      createElement(NewRequestScreen as never, { api, onCreated: () => undefined } as never),
      bridge,
    );

    const scan = screen.findAll('[aria-label="Сканировать код"]').at(0);

    assert.ok(scan, 'кнопки сканирования нет');

    await screen.act(() => (scan as HTMLButtonElement).click());
    await screen.act(() => undefined);

    assert.match(screen.text, /подъезд 1/);
    assert.ok(
      calls.some((call) => call.path.includes('/api/context/ent_b1_1')),
      `код не дошёл до сервера: ${calls.map((call) => call.path).join(', ')}`,
    );

    await screen.unmount();
  });

  it('не наш код объясняется словами, а не молчанием', async () => {
    const { bridge } = createMockBridge({ codeReaderResult: 'https://example.com/акция' });
    const { api } = apiWith({});

    const screen = await render(
      createElement(NewRequestScreen as never, { api, onCreated: () => undefined } as never),
      bridge,
    );

    const scan = screen.findAll('[aria-label="Сканировать код"]').at(0);

    await screen.act(() => (scan as HTMLButtonElement).click());
    await screen.act(() => undefined);

    assert.match(screen.text, /не код объекта/);

    await screen.unmount();
  });

  it('объявление пересылается соседям через мессенджер', async () => {
    const events: string[] = [];
    const { bridge } = createMockBridge({ onEvent: (type: string) => events.push(type) });
    const { api } = apiWith({
      '/api/announcements': [
        {
          id: 'ann-1',
          title: 'Отключение воды',
          body: 'С 10 до 16 в третьем подъезде',
          createdAt: '2026-09-03T08:00:00Z',
          audience: 'подъезд 3',
          recipients: 24,
        },
      ],
    });

    const screen = await render(createElement(AnnouncementsScreen as never, { api } as never), bridge);
    const share = screen.findAll('button').find((button) => button.getAttribute('aria-label') === 'Переслать');

    assert.ok(share, 'кнопки пересылки нет');

    await screen.act(() => (share as HTMLButtonElement).click());

    assert.ok(
      events.some((event) => event === 'WebAppMaxShare' || event === 'WebAppShare'),
      `мост не звали: ${events.join(', ')}`,
    );

    await screen.unmount();
  });
});

describe('фото к заявке', () => {
  it('снимок уходит на сервер сразу и прикладывается к заявке', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'POST /api/files': { kind: 'photo', token: 'file:f1' },
      '/api/requests': { joined: false, request: REQUEST },
    });

    const screen = await render(
      createElement(NewRequestScreen as never, { api, onCreated: () => undefined } as never),
      bridge,
    );

    await screen.act(() => pick(screen.find<HTMLInputElement>('.composer-file'), jpeg()));
    await screen.act(() => undefined);

    const upload = calls.find((call) => call.path === '/api/files');

    assert.equal(JSON.parse(upload?.body ?? '{}').contentType, 'image/jpeg');
    assert.match(screen.text, /1/, 'число снимков видно на кнопке');

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('textarea'), 'Течёт кран'));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());

    const post = calls.find((call) => call.path === '/api/requests' && call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), {
      description: 'Течёт кран',
      attachments: [{ kind: 'photo', token: 'file:f1' }],
    });

    await screen.unmount();
  });

  it('неудача со снимком не отменяет заявку', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusing(400, 'file_too_large', 'Снимок слишком большой');

    const screen = await render(
      createElement(NewRequestScreen as never, { api, onCreated: () => undefined } as never),
      bridge,
    );

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('#description'), 'Течёт кран'));
    await screen.act(() => pick(screen.find<HTMLInputElement>('.composer-file'), jpeg()));
    await screen.act(() => undefined);

    assert.match(screen.text, /Снимок слишком большой/);
    assert.equal(screen.find<HTMLButtonElement>('.composer-send').disabled, false, 'заявку всё равно отправят');

    await screen.unmount();
  });

  it('снимок из заявки забирается с токеном сессии, а не ссылкой', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests/req-1': { ...REQUEST, attachments: [{ kind: 'photo', token: 'file:f1' }] },
    });

    const screen = await render(createElement(RequestScreen as never, { api, id: 'req-1' } as never), bridge);

    assert.ok(
      calls.some((call) => call.path === '/api/files/f1'),
      'за снимком не сходили',
    );

    await screen.unmount();
  });

  it('мастер отчитывается снимком вместе с «выполнено»', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests/req-1/actions': { actions: ['done'] },
      '/api/requests/req-1/transition': REQUEST,
      'POST /api/files': { kind: 'photo', token: 'file:after' },
      '/api/staff': [],
      '/api/requests/req-1': { ...REQUEST, status: 'in_progress' },
    });

    const screen = await render(
      createElement(RequestScreen as never, { api, id: 'req-1', staff: true } as never),
      bridge,
    );

    await screen.act(() => pick(screen.find<HTMLInputElement>('.photo-field input'), jpeg('после.jpg')));
    await screen.act(() => undefined);

    assert.match(screen.text, /1/, 'число снимков видно на кнопке');

    await screen.act(() => screen.find<HTMLButtonElement>('.actions button, .actions-more button').click());
    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('.confirm-field'), 'Поменял смеситель'));
    await screen.act(() => screen.find<HTMLButtonElement>('.confirm-do').click());

    const post = calls.find((call) => call.path.endsWith('/transition'));

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), {
      to: 'done',
      comment: 'Поменял смеситель',
      attachments: [{ kind: 'photo', token: 'file:after' }],
      provedBy: 'demo',
    });

    await screen.unmount();
  });

  it('поле для снимка результата появляется только вместе с «выполнено»', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests/req-1/actions': { actions: ['accepted', 'rejected'] },
      '/api/staff': [],
      '/api/requests/req-1': REQUEST,
    });

    const screen = await render(
      createElement(RequestScreen as never, { api, id: 'req-1', staff: true } as never),
      bridge,
    );

    assert.equal(screen.findAll('.actions .photo-field').length, 0, 'фото результата, только при сдаче работы');

    await screen.unmount();
  });

  it('снимок из истории показывается там, где сделан', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/requests/req-1': {
        ...REQUEST,
        status: 'done',
        history: [
          { at: '2026-09-03T10:00:00Z', status: 'new', role: 'resident' },
          {
            at: '2026-09-03T12:00:00Z',
            status: 'done',
            role: 'technician',
            attachments: [{ kind: 'photo', token: 'file:after' }],
          },
        ],
      },
    });

    const screen = await render(createElement(RequestScreen as never, { api, id: 'req-1' } as never), bridge);

    assert.ok(
      calls.some((call) => call.path === '/api/files/after'),
      'снимок результата не запросили',
    );
    assert.equal(screen.findAll('.timeline .attachments').length, 1);

    await screen.unmount();
  });

  it('вложение без картинки честно называется словом', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/requests/req-1': {
        ...REQUEST,
        attachments: [{ kind: 'voice', token: 'max-file-1', transcript: 'нет воды' }],
      },
    });

    const screen = await render(createElement(RequestScreen as never, { api, id: 'req-1' } as never), bridge);

    assert.match(screen.text, /голосовое: нет воды/);
    assert.equal(screen.findAll('img').length, 0);

    await screen.unmount();
  });
});

describe('тарифы дома', () => {
  const TARIFFS = [
    { kind: 'cold_water', title: 'Холодная вода', unit: '₽ за м³', value: 43.5, own: false },
    {
      kind: 'maintenance',
      title: 'Содержание и текущий ремонт',
      unit: '₽ за м² в месяц',
      value: 50,
      own: true,
      since: '2026-09-01T00:00:00Z',
    },
  ];

  it('умолчание отличается от заданного управляющей компанией', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/tariffs': TARIFFS });

    const screen = await render(createElement(TariffsScreen as never, { api } as never), bridge);

    // Пометка про умолчание стоит одной сноской под списком, а не в каждой строке.
    assert.match(screen.text, /Холодная вода₽ за м³43,5/);
    assert.match(screen.text, /₽ за м² в месяц · с 1 сентября/);
    assert.equal(screen.text.match(/по умолчанию/g)?.length ?? 0, 0);

    await screen.act(() => (screen.findAll('.tariff-row')[0] as HTMLElement).click());
    assert.equal(screen.findAll('.tariff-edit').length, 0);

    await screen.unmount();
  });

  it('управляющий правит число нажатием по нему', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/tariffs': TARIFFS });

    const screen = await render(createElement(TariffsScreen as never, { api, editable: true } as never), bridge);

    await screen.act(() => (screen.findAll('.tariff-row')[0] as HTMLElement).click());
    await screen.act(() => typeInto(screen.find<HTMLInputElement>('.tariff-edit input'), '44,9'));
    await screen.act(() => screen.find<HTMLButtonElement>('.tariff-save').click());

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { kind: 'cold_water', value: 44.9 });

    await screen.unmount();
  });
});

describe('заведение дома', () => {
  it('квартиры заводятся строками, а не набранной вручную выгрузкой', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/buildings': [{ id: 'b1', code: 'Д15', address: 'ул. Ленина, 15', current: true }],
      'POST /api/import/apartments': { added: 2, updated: 0, meters: 3, problems: [] },
    });

    const screen = await render(createElement(ImportScreen as never, { api } as never), bridge);
    await screen.act(() => {});

    assert.equal(screen.find<HTMLInputElement>('#house-address').value, 'ул. Ленина, 15');
    assert.equal(screen.findAll('button').filter((node) => /Завести квартиры/.test(node.textContent ?? '')).length, 0);

    await screen.act(() => tap(screen, 'Добавить квартиру'));

    const number = screen.find<HTMLInputElement>('[aria-label="Помещение, строка 1"]');

    assert.ok(number, 'строка списка квартир не появилась');

    await screen.act(() => typeInto(number, '7'));
    await screen.act(() => typeInto(screen.find<HTMLInputElement>('[aria-label="Площадь, строка 1"]'), '54,3'));
    await screen.act(() =>
      (screen.findAll('button').find((node) => /Завести квартиры/.test(node.textContent ?? '')) as HTMLButtonElement)
        .click(),
    );
    await screen.act(() => {});

    const post = calls.find((call) => call.path === '/api/import/apartments');

    assert.ok(post, 'список квартир не ушёл на сервер');
    assert.match(JSON.parse(post?.body ?? '{}').csv ?? '', /7;1;1;54,3/);
    assert.match(screen.text, /Заведено 2/);

    await screen.unmount();
  });

  it('выгрузку из таблицы разбирают в строки до отправки', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/buildings': [{ id: 'b1', code: 'Д15', address: 'ул. Ленина, 15', current: true }],
    });

    const screen = await render(createElement(ImportScreen as never, { api } as never), bridge);
    await screen.act(() => {});

    await screen.act(() => tap(screen, 'Вставить список квартир'));
    await screen.act(() =>
      typeInto(screen.find<HTMLTextAreaElement>('.paste textarea'), 'Помещение;Подъезд;Стояк\n1;1;2\n2;1;2'),
    );
    await screen.act(() => tap(screen, 'Разобрать строки'));

    assert.equal(screen.find<HTMLInputElement>('[aria-label="Помещение, строка 1"]').value, '1');
    assert.equal(screen.find<HTMLInputElement>('[aria-label="Стояк, строка 2"]').value, '2');

    await screen.unmount();
  });

  it('показывает, привязан ли чат дома, и даёт его отвязать', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/buildings': [{ id: 'b1', code: 'Д15', address: 'ул. Ленина, 15', current: true, chatBound: true }],
      'DELETE /api/buildings/chat': { id: 'b1', code: 'Д15', address: 'ул. Ленина, 15', chatBound: false },
    });

    const screen = await render(createElement(ImportScreen as never, { api } as never), bridge);
    await screen.act(() => {});

    assert.match(screen.text, /Привязан/);

    await screen.act(() =>
      (screen.findAll('button').find((node) => (node.textContent ?? '').trim() === 'Отвязать') as HTMLButtonElement)
        .click(),
    );
    await screen.act(() => {});

    assert.equal(calls.some((call) => call.path === '/api/buildings/chat' && call.method === 'DELETE'), true);
    assert.match(screen.text, /Не привязан/);
    assert.equal(screen.findAll('button').some((node) => (node.textContent ?? '').trim() === 'Отвязать'), false);

    await screen.unmount();
  });

  it('без привязанного чата объясняет, как его привязать', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/buildings': [{ id: 'b1', code: 'Д15', address: 'ул. Ленина, 15', current: true, chatBound: false }],
    });

    const screen = await render(createElement(ImportScreen as never, { api } as never), bridge);
    await screen.act(() => {});

    assert.match(screen.text, /Добавьте бота в общий чат/);

    await screen.unmount();
  });

  it('без прочитанной карточки форму не показывают', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiRefusing(503, 'unavailable', 'Сервер недоступен');

    const screen = await render(createElement(ImportScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Карточка дома не загрузилась/);
    assert.equal(screen.findAll('#house-emergency-phone').length, 0, 'пустые поля стёрли бы сведения дома');
    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);

    await screen.unmount();
  });

  it('строку с ошибкой называет отдельно', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/buildings': [],
      'POST /api/import/equipment': { added: 0, problems: [{ line: 2, message: 'Вид «телепорт» не опознан' }] },
    });

    const screen = await render(createElement(ImportScreen as never, { api } as never), bridge);

    await screen.act(() => tap(screen, 'Добавить оборудование'));
    await screen.act(() => typeInto(screen.find<HTMLInputElement>('[aria-label="Код, строка 1"]'), 'x-1'));
    await screen.act(() => typeInto(screen.find<HTMLInputElement>('[aria-label="Название, строка 1"]'), 'Ворота'));
    await screen.act(() => typeInto(screen.find<HTMLInputElement>('[aria-label="Вид, строка 1"]'), 'телепорт'));
    await screen.act(() =>
      (
        screen.findAll('button').find((node) => /Завести оборудование/.test(node.textContent ?? '')) as HTMLButtonElement
      ).click(),
    );
    await screen.act(() => {});

    assert.match(screen.text, /Строка 2Вид «телепорт» не опознан/);

    await screen.unmount();
  });
});

describe('осмотры общего имущества', () => {
  const ROUND = {
    id: 'ins-1',
    title: 'Осмотр подъезда',
    entrance: 1,
    checked: 1,
    overdue: false,
    dueAt: '2026-10-20T10:00:00Z',
    requestIds: [],
    items: [
      { title: 'Освещение и выключатели', state: 'ok' },
      { title: 'Почтовые ящики' },
    ],
  };

  it('отметку меняют тем же рядом кнопок, которым её поставили', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/inspections': [ROUND],
      'POST /api/inspections/ins-1/items/0': { inspection: ROUND },
    });

    const screen = await render(
      createElement(InspectionsScreen as never, { api, onOpen: () => undefined } as never),
      bridge,
    );
    await screen.act(() => {});

    const mark = screen.find<HTMLButtonElement>('[aria-label="Недостаток: Освещение и выключатели"]');

    assert.ok(mark, 'у отмеченного пункта нет кнопок: отметку не снять');

    await screen.act(() => mark.click());

    assert.equal(
      screen.find('.check-form input')?.getAttribute('placeholder'),
      'Что именно не так',
      'отметка не переоткрылась разбором недостатка',
    );

    await screen.act(() => typeInto(screen.find<HTMLInputElement>('.check-form input'), 'Лампа мигает'));
    await screen.act(() => tap(screen, 'Завести заявку'));
    await screen.act(() => {});

    const post = calls.find((call) => call.path === '/api/inspections/ins-1/items/0');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { state: 'problem', comment: 'Лампа мигает' });

    await screen.unmount();
  });

  it('заведение заявки главнее отмены и не ждёт своей строки', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/inspections': [ROUND] });

    const screen = await render(
      createElement(InspectionsScreen as never, { api, onOpen: () => undefined } as never),
      bridge,
    );
    await screen.act(() => {});

    await screen.act(() => screen.find<HTMLButtonElement>('[aria-label="Недостаток: Почтовые ящики"]').click());

    const send = screen.find<HTMLButtonElement>('.check-form .send-row button:last-child');

    assert.match(send.textContent ?? '', /Завести заявку/);
    assert.equal(send.disabled, true, 'без описания заявку не заводят');
    assert.match(screen.find('.check-cancel')?.textContent ?? '', /Отмена/);

    await screen.unmount();
  });
});

describe('работа дома', () => {
  it('числа подписаны адресом и длиной периода', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/quality': {
        buildingId: 'b2',
        address: 'ул. Ленина, 17',
        days: 30,
        from: '2026-08-19T00:00:00Z',
        to: '2026-09-18T00:00:00Z',
        open: 2,
        overdue: 0,
        created: 5,
        closed: 4,
        rated: 2,
      },
    });

    const screen = await render(createElement(QualityScreen as never, { api } as never), bridge);

    assert.match(screen.text, /ул\. Ленина, 17/, 'без адреса сотрудник считает это домом смены');
    assert.match(screen.text, /За 30 дней/);

    await screen.unmount();
  });
});

describe('дома компании', () => {
  const PORTFOLIO = [{ buildingId: 'b1', code: 'Д15', address: 'ул. Ленина, 15', open: 2, overdue: 0 }];

  it('управляющий заводит новый адрес и попадает в него', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/buildings/report': PORTFOLIO,
      'POST /api/buildings': { id: 'b2', code: 'Д17', address: 'ул. Ленина, 17', chatBound: false },
    });

    const opened: string[] = [];
    const screen = await render(
      createElement(BuildingsScreen as never, {
        api,
        canAdd: true,
        onPick: () => undefined,
        onAdd: (id: string) => opened.push(id),
      } as never),
      bridge,
    );
    await screen.act(() => {});

    await screen.act(() =>
      (screen.findAll('button, [role="button"]').find((node) => /Завести дом/.test(node.textContent ?? '')) as HTMLElement)
        .click(),
    );

    await screen.act(() => typeInto(screen.find<HTMLInputElement>('#new-house-code'), 'Д17'));
    await screen.act(() => typeInto(screen.find<HTMLInputElement>('#new-house-address'), 'ул. Ленина, 17'));
    await screen.act(() =>
      (screen.findAll('button').find((node) => (node.textContent ?? '').trim() === 'Завести') as HTMLButtonElement)
        .click(),
    );
    await screen.act(() => {});

    const sent = calls.find((call) => call.path === '/api/buildings' && call.method === 'POST');

    assert.equal(sent?.body, JSON.stringify({ code: 'Д17', address: 'ул. Ленина, 17' }));
    assert.deepEqual(opened, ['b2']);

    await screen.unmount();
  });

  it('список говорит, куда ведёт адрес: в карточку дома или в его очередь', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/buildings/report': PORTFOLIO });

    const card = await render(
      createElement(BuildingsScreen as never, { api, opens: 'card', onPick: () => undefined } as never),
      bridge,
    );
    await card.act(() => {});

    assert.match(card.text, /Адрес открывает карточку дома/);

    await card.unmount();

    const queue = await render(
      createElement(BuildingsScreen as never, { api, onPick: () => undefined } as never),
      bridge,
    );
    await queue.act(() => {});

    assert.match(queue.text, /Адрес переключает работу на этот дом/);

    await queue.unmount();
  });

  it('диспетчеру заведение дома не показывают', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/buildings/report': PORTFOLIO });

    const screen = await render(
      createElement(BuildingsScreen as never, { api, onPick: () => undefined } as never),
      bridge,
    );
    await screen.act(() => {});

    assert.match(screen.text, /Д15/);
    assert.equal(/Завести дом/.test(screen.text), false);

    await screen.unmount();
  });
});

describe('журнал действий', () => {
  it('показывает, кто и что сделал', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/audit': [
        {
          id: 'a-1',
          at: '2026-09-07T10:00:00Z',
          actorName: 'Ольга',
          action: 'request_rejected',
          actionTitle: 'Отклонена заявка',
          subject: 'Д15-2609-0001',
          details: 'Зона ответственности собственника',
        },
      ],
    });

    const screen = await render(createElement(AuditScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Отклонена заявка · Д15-2609-0001/);
    assert.match(screen.text, /Ольга/);
    assert.match(screen.text, /Зона ответственности собственника/);

    await screen.unmount();
  });

  it('в пустом журнале не показывает список', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/audit': [] });

    const screen = await render(createElement(AuditScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Пока тихо/);

    await screen.unmount();
  });
});

describe('профиль жильца', () => {
  const props = { displayName: 'Мария', bound: true, onForgotten: () => undefined };

  it('уже оставленный телефон показывается, а не предлагается заново', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/me/notices': [] });

    const screen = await render(
      createElement(ProfileScreen as never, { api, ...props, phone: '+79991234567' } as never),
      bridge,
    );

    assert.match(screen.text, /\+79991234567/);
    assert.match(screen.text, /Убрать/);

    await screen.unmount();
  });

  it('полномочия старшего показываются со сроком', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/me/notices': [] });

    const screen = await render(
      createElement(ProfileScreen as never, {
        api,
        ...props,
        elder: { entrance: 2, until: '2028-09-15T10:00:00Z' },
      } as never),
      bridge,
    );

    assert.match(screen.text, /Старший по подъезду 2/);
    assert.match(screen.text, /Полномочия до 15 сентября 2028/);

    await screen.unmount();
  });

  it('удаление профиля спрашивает подтверждение', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/me/notices': [] });

    const screen = await render(createElement(ProfileScreen as never, { api, ...props } as never), bridge);

    await screen.act(() =>
      (screen.findAll('button').find((node) => /Удалить профиль/.test(node.textContent ?? '')) as HTMLButtonElement)
        .click(),
    );

    assert.equal(calls.some((call) => call.method === 'DELETE'), false);
    assert.match(screen.text, /Квартира отвяжется/);

    await screen.unmount();
  });

  it('уведомления переключаются', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/me/notices': [{ kind: 'news', title: 'Объявления дома', on: true }],
    });

    const screen = await render(createElement(ProfileScreen as never, { api, ...props } as never), bridge);
    await screen.act(() => {});
    await screen.act(() => screen.find<HTMLInputElement>('input[type="checkbox"]').click());
    await screen.act(() => {});

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { kind: 'news', on: false });

    await screen.unmount();
  });
});

describe('длинный текст отдельным экраном', () => {
  it('показывает документ целиком и уводит назад', async () => {
    const { bridge } = createMockBridge();
    let back = 0;

    const screen = await render(
      createElement(DocumentScreen as never, {
        text: 'Протокол общего собрания\n\nРешение: принято',
        onBack: () => (back += 1),
      } as never),
      bridge,
    );

    assert.match(screen.text, /Протокол общего собрания/);
    assert.match(screen.text, /Решение: принято/);

    const backButton = screen.findAll('button').find((button) => button.textContent === 'Назад');

    assert.ok(backButton, 'кнопки «Назад» нет');
    await screen.act(() => (backButton as HTMLButtonElement).click());

    assert.equal(back, 1);

    await screen.unmount();
  });

  it('копирует текст и говорит об этом', async () => {
    const { bridge } = createMockBridge();
    const copied: string[] = [];

    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => (copied.push(text), Promise.resolve()) },
    });

    const screen = await render(
      createElement(DocumentScreen as never, { text: 'Заявок: 1', onBack: () => {} } as never),
      bridge,
    );

    const copy = screen.findAll('button').find((button) => button.textContent === 'Скопировать');

    await screen.act(() => (copy as HTMLButtonElement).click());
    await screen.act(() => {});

    assert.deepEqual(copied, ['Заявок: 1']);
    assert.match(screen.text, /Скопировано/);
    assert.equal(screen.findAll('[role="status"]').length, 1);

    await screen.unmount();
  });

  it('недоступный буфер обмена называет причину', async () => {
    const { bridge } = createMockBridge();

    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });

    const execCommand = (globalThis.document as { execCommand?: unknown }).execCommand;

    Object.defineProperty(globalThis.document, 'execCommand', {
      configurable: true,
      value: () => false,
    });

    const screen = await render(
      createElement(DocumentScreen as never, { text: 'Заявок: 1', onBack: () => {} } as never),
      bridge,
    );

    const copy = screen.findAll('button').find((button) => button.textContent === 'Скопировать');

    await screen.act(() => (copy as HTMLButtonElement).click());
    await screen.act(() => {});

    assert.equal(screen.findAll('[role="alert"]').length, 1);
    assert.match(screen.text, /выделите текст вручную/);
    assert.doesNotMatch(screen.text, /Скопировано/);

    await screen.unmount();

    if (execCommand === undefined) delete (globalThis.document as { execCommand?: unknown }).execCommand;
    else Object.defineProperty(globalThis.document, 'execCommand', { configurable: true, value: execCommand });
  });
});

/** Читается всё, а записывается с отказом: так выглядит потерянное право посреди работы. */
const apiRefusingWrites = (replies: Record<string, unknown>, status: number, code: string, message: string) => {
  const calls: Recorded[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace('http://api.test', '');
    const method = init?.method ?? 'GET';

    calls.push({ path, method });

    if (method !== 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify({ error: code, message }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    const key = Object.keys(replies).find((candidate) => path.startsWith(candidate));

    return Promise.resolve(
      new Response(JSON.stringify(key === undefined ? {} : replies[key]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { api: new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub }), calls };
};

describe('отказ посреди работы', () => {
  it('несостоявшийся переход называет причину, а не молчит', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusingWrites(
      {
        '/api/requests/req-1/actions': { actions: ['accepted'] },
        '/api/staff': [],
        '/api/requests/req-1': REQUEST,
      },
      403,
      'forbidden',
      'Заявку принимает диспетчер',
    );

    const screen = await render(
      createElement(RequestScreen as never, { api, id: 'req-1', staff: true } as never),
      bridge,
    );

    await screen.act(() => screen.find<HTMLButtonElement>('.actions button').click());

    assert.match(screen.text, /Заявку принимает диспетчер/);

    await screen.unmount();
  });

  it('непринятая приёмка не выглядит принятой', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusingWrites(
      {
        '/api/requests/req-1/actions': { actions: [] },
        '/api/requests/req-1': { ...REQUEST, status: 'done' },
      },
      409,
      'wrong_status',
      'Заявка уже закрыта',
    );

    const screen = await render(createElement(RequestScreen as never, { api, id: 'req-1' } as never), bridge);

    const accept = screen.findAll('button').find((button) => button.textContent === 'Принять работу');

    await screen.act(() => (accept as HTMLButtonElement).click());

    assert.match(screen.text, /Заявка уже закрыта/);

    await screen.unmount();
  });

  it('переключатель уведомлений возвращается, если сервер отказал', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiRefusingWrites(
      { '/api/me/notices': [{ kind: 'news', title: 'Объявления дома', on: true }] },
      500,
      'internal',
      'Хранилище недоступно',
    );

    const screen = await render(
      createElement(ProfileScreen as never, {
        api,
        displayName: 'Мария',
        bound: true,
        onForgotten: () => undefined,
      } as never),
      bridge,
    );

    await screen.act(() => {});

    const toggle = screen.find<HTMLInputElement>('input[type="checkbox"]');

    assert.equal(toggle.checked, true);

    await screen.act(() => toggle.click());
    await screen.act(() => {});

    assert.equal(screen.find<HTMLInputElement>('input[type="checkbox"]').checked, true, 'состояние не приврало');

    await screen.unmount();
  });
});

describe('нераспознанная наклейка', () => {
  it('заявка уходит по квартире, а не с кодом, которого нет', async () => {
    const { bridge } = createMockBridge();
    const calls: Recorded[] = [];

    const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace('http://api.test', '');

      calls.push({
        path,
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      });

      if (path.startsWith('/api/context') || path.startsWith('/api/objects')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'not_found', message: 'Объект не найден' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({ joined: false, request: REQUEST }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const api = new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub });

    const screen = await render(
      createElement(NewRequestScreen as never, {
        api,
        startParam: 'eqp_b1_нет',
        where: 'Квартира 1',
        onCreated: () => undefined,
      } as never),
      bridge,
    );

    assert.match(screen.text, /Код с наклейки не распознан/);

    await screen.act(() => typeInto(screen.find<HTMLTextAreaElement>('textarea'), 'Не горит лампа в подъезде'));
    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { description: 'Не горит лампа в подъезде' });

    await screen.unmount();
  });
});

describe('код для гостя', () => {
  const DEVICE = { id: 'dev-1', title: 'Подъезд 1', kind: 'door', online: true };

  it('открытый экран код не тратит', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/devices/dev-1/guest': { code: '4821', expiresAt: '2026-09-03T10:15:00Z' } });

    const screen = await render(createElement(GuestScreen as never, { api, device: DEVICE } as never), bridge);

    assert.equal(calls.length, 0, 'одноразовый код выдаётся нажатием, а не открытием');
    assert.match(screen.text, /Выдать код/);

    await screen.act(() => screen.find<HTMLButtonElement>('button').click());

    assert.match(screen.text, /4821/);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1);

    await screen.unmount();
  });
});

describe('профиль смены', () => {
  it('дежурство принимается прямо в профиле', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/me/notices': [],
      '/api/residents/disp-1/duty': { id: 'disp-1', displayName: 'Ольга', role: 'dispatcher', onDuty: true },
    });

    const screen = await render(
      createElement(ProfileScreen as never, {
        api,
        displayName: 'Ольга',
        bound: false,
        duty: { residentId: 'disp-1', onDuty: false },
        onDocument: () => {},
        onForgotten: () => {},
      } as never),
      bridge,
    );

    assert.match(screen.text, /Я на дежурстве/);
    assert.match(screen.text, /Ночные заявки уйдут всей смене/);

    await screen.act(() => screen.find<HTMLInputElement>('input[type="checkbox"]').click());

    const post = calls.find((call) => call.method === 'POST');

    assert.equal(post?.path, '/api/residents/disp-1/duty');
    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { onDuty: true });
    assert.match(screen.text, /Ночные заявки идут вам/);

    await screen.unmount();
  });

  it('жильцу дежурство в профиле не показывают', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/me/notices': [] });

    const screen = await render(
      createElement(ProfileScreen as never, {
        api,
        displayName: 'Мария',
        bound: true,
        onDocument: () => {},
        onForgotten: () => {},
      } as never),
      bridge,
    );

    assert.doesNotMatch(screen.text, /дежурств/i);

    await screen.unmount();
  });
});

describe('наряды мастера', () => {
  it('наряд берут в работу прямо из списка', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'GET /api/requests?scope=mine': [{ ...REQUEST, id: 'req-7', number: 'Д15-7', status: 'accepted' }],
    });

    const screen = await render(
      createElement(RequestListScreen as never, { api, staff: true, onOpen: () => {} } as never),
      bridge,
    );

    await screen.act(() => tap(screen, 'В работу'));

    const post = calls.find((call) => call.method === 'POST');

    assert.equal(post?.path, '/api/requests/req-7/transition');
    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { to: 'in_progress' });

    await screen.unmount();
  });

  it('у жильца кнопки перехода в списке нет: это дело смены', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      'GET /api/requests?scope=mine': [{ ...REQUEST, id: 'req-7', number: 'Д15-7', status: 'accepted' }],
    });

    const screen = await render(
      createElement(RequestListScreen as never, { api, onOpen: () => {} } as never),
      bridge,
    );

    assert.equal(screen.findAll('.row-action').length, 0);

    await screen.unmount();
  });
});

describe('поддержка', () => {
  const CONTACTS = {
    buildingId: 'b1',
    address: 'ул. Ленина, 15',
    managementCompany: 'УК «Домовой»',
    contact: {
      name: 'Гордеева Нина Павловна',
      role: 'управляющая домом',
      phone: '+7 900 120-45-15',
      email: 'nina@uk.ru',
    },
    duty: { displayName: 'Ольга Титова', phone: '+7 900 000-11-22' },
  };

  const TICKET = {
    id: 'tic-1',
    subject: 'Когда включат отопление?',
    status: 'answered',
    statusTitle: 'отвечено',
    createdAt: '2026-09-07T10:00:00Z',
    updatedAt: '2026-09-07T12:00:00Z',
    messages: [
      { at: '2026-09-07T10:00:00Z', from: 'resident', text: 'Когда включат отопление?', own: true },
      {
        at: '2026-09-07T12:00:00Z',
        from: 'staff',
        text: 'Подадим тепло 25 сентября.',
        authorName: 'Ольга Титова',
      },
    ],
  };

  it('аварийную службу и приём показывают первой строкой', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/house/contacts': {
        ...CONTACTS,
        service: {
          emergencyPhone: '+7 900 120-00-15',
          phone: '+7 900 120-45-00',
          hours: 'пн-пт 9:00-18:00',
          office: 'ул. Ленина, 15, офис 1',
          officeHours: 'вт и чт 15:00-19:00',
        },
      },
      '/api/support': [],
    });

    const screen = await render(createElement(SupportScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Аварийная служба/);
    assert.match(screen.text, /\+7 900 120-00-15 · круглосуточно/);
    assert.match(screen.text, /\+7 900 120-45-00 · пн-пт 9:00-18:00/);
    assert.match(screen.text, /ул\. Ленина, 15, офис 1 · вт и чт 15:00-19:00/);

    await screen.unmount();
  });

  it('жильцу сначала показывают, к кому обращаться', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/house/contacts': CONTACTS, '/api/support': [] });

    const screen = await render(createElement(SupportScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Гордеева Нина Павловна/);
    assert.match(screen.text, /\+7 900 120-45-15/);
    assert.match(screen.text, /nina@uk\.ru/);
    assert.match(screen.text, /Ольга Титова/, 'дежурный виден рядом с контактами');

    await screen.unmount();
  });

  it('пустой вопрос до сервера не доходит', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/house/contacts': CONTACTS, '/api/support': [] });

    const screen = await render(createElement(SupportScreen as never, { api } as never), bridge);

    await screen.act(() => tap(screen, 'Новый вопрос'));

    assert.equal(screen.find<HTMLButtonElement>('.composer-send').disabled, true, 'пустое не отправить');
    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);

    await screen.unmount();
  });

  it('написанный вопрос уходит в управляющую компанию', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'GET /api/support': [],
      'POST /api/support': TICKET,
      '/api/house/contacts': CONTACTS,
    });

    const screen = await render(createElement(SupportScreen as never, { api } as never), bridge);

    await screen.act(() => tap(screen, 'Новый вопрос'));

    await screen.act(() => {
      typeInto(screen.find<HTMLTextAreaElement>('#support-ask'), 'Когда включат отопление?');
    });

    await screen.act(() => screen.find<HTMLButtonElement>('.composer-send').click());

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { text: 'Когда включат отопление?' });
    assert.match(screen.text, /Подадим тепло 25 сентября/, 'ответ виден сразу в переписке');

    await screen.unmount();
  });

  it('просроченный ответ смена видит в строке обращения', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/support': [
        {
          ...TICKET,
          status: 'open',
          statusTitle: 'ждёт ответа',
          authorName: 'Мария',
          apartment: 1,
          waitingSince: new Date(Date.now() - 15 * 24 * 3600_000).toISOString(),
          answerDueAt: new Date(Date.now() - 24 * 3600_000).toISOString(),
          overdue: true,
        },
      ],
    });

    const screen = await render(createElement(SupportScreen as never, { api, staff: true } as never), bridge);

    assert.match(screen.text, /срок ответа истёк/);

    await screen.unmount();
  });

  it('смене показывают, кто спросил и сколько вопрос ждёт', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/support': [
        {
          ...TICKET,
          status: 'open',
          statusTitle: 'ждёт ответа',
          authorName: 'Мария',
          apartment: 1,
          waitingSince: new Date(Date.now() - 3 * 3600_000).toISOString(),
        },
      ],
    });

    const screen = await render(createElement(SupportScreen as never, { api, staff: true } as never), bridge);

    assert.match(screen.text, /Когда включат отопление\?/);
    assert.match(screen.text, /Мария, кв\. 1 · ждёт 3 ч/);
    assert.match(screen.text, /1 ждёт ответа/, 'счётчик над списком');
    assert.doesNotMatch(screen.text, /Спросить/);

    await screen.unmount();
  });

  it('закрытое обращение переписку не предлагает', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/house/contacts': CONTACTS,
      '/api/support': [{ ...TICKET, status: 'closed', statusTitle: 'закрыто' }],
    });

    const screen = await render(createElement(SupportScreen as never, { api } as never), bridge);

    await screen.act(() => tap(screen, 'Когда включат отопление?'));

    assert.match(screen.text, /Вопрос закрыт/);

    await screen.unmount();
  });
});

describe('наклейки', () => {
  const STICKERS = {
    styles: [
      { name: 'classic', title: 'Классика', paper: '#ffffff', ink: '#111111', accent: '#111111' },
      { name: 'night', title: 'Ночь', paper: '#14161c', ink: '#f4f6fb', accent: '#8ab4ff' },
    ],
    objects: [
      {
        payload: 'ent_b1_1',
        caption: 'Подъезд 1',
        link: 'https://max.ru/uk_bot?start=ent_b1_1',
        kind: 'entrance',
        target: 'подъезд 1',
      },
      {
        payload: 'eqp_b1_lift-1',
        caption: 'Лифт, подъезд 1',
        link: 'https://max.ru/uk_bot?start=eqp_b1_lift-1',
        kind: 'equipment',
        target: 'оборудование lift-1',
      },
    ],
  };

  it('показывает объекты дома по группам', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/stickers': STICKERS });

    const screen = await render(createElement(StickersScreen as never, { api } as never), bridge);

    assert.match(screen.text, /Подъезды и стояки/);
    assert.match(screen.text, /Подъезд 1/);
    assert.match(screen.text, /Оборудование/);
    assert.match(screen.text, /Лифт, подъезд 1/);

    await screen.unmount();
  });

  it('лист для печати заказывает смена, а жильцу его не предлагают', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'POST /api/stickers/sheet': { count: 12, address: 'ул. Ленина, 15' },
      '/api/stickers': STICKERS,
    });

    const forResident = await render(createElement(StickersScreen as never, { api } as never), bridge);

    assert.doesNotMatch(forResident.text, /Лист для печати/);
    await forResident.unmount();

    const screen = await render(createElement(StickersScreen as never, { api, staff: true } as never), bridge);

    await screen.act(() => tap(screen, 'Прислать лист'));

    assert.ok(calls.some((call) => call.path === '/api/stickers/sheet' && call.method === 'POST'));
    assert.match(screen.text, /на нём 12 кодов/);

    await screen.unmount();
  });

  it('у выбранного объекта показывает саму наклейку и стили', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'GET /api/stickers/image': '<svg id="drawn"></svg>',
      '/api/stickers': STICKERS,
    });

    const screen = await render(createElement(StickersScreen as never, { api } as never), bridge);

    await screen.act(() => tap(screen, 'Подъезд 1'));

    assert.match(screen.text, /Ночь/, 'стиль выбирается на месте');
    assert.equal(screen.findAll('.swatch').length, 2, 'у стиля виден образец цвета');
    assert.match(screen.find<HTMLImageElement>('img.sticker-preview').src, /svg/);
    assert.ok(
      calls.some((call) => call.path.startsWith('/api/stickers/image?payload=ent_b1_1')),
      'картинку рисует сервер, а не экран',
    );

    await screen.unmount();
  });

  it('наклейка уходит в переписку, откуда её пересылают', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'GET /api/stickers/image': '<svg id="drawn"></svg>',
      'POST /api/stickers/send': {
        caption: 'Подъезд 1',
        payload: 'ent_b1_1',
        link: 'l',
        as: 'document',
        messageId: 'mid.1',
      },
      '/api/stickers': STICKERS,
    });

    const screen = await render(createElement(StickersScreen as never, { api } as never), bridge);

    await screen.act(() => tap(screen, 'Подъезд 1'));
    await screen.act(() => tap(screen, 'Файлом для печати'));

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { payload: 'ent_b1_1', style: 'classic', as: 'document' });
    assert.match(screen.text, /Наклейка пришла файлом/);

    await screen.unmount();
  });
});

describe('история объекта', () => {
  it('средний срок дописывается к числу поломок, а не заменяет его', () => {
    assert.equal(objectHistory(14, undefined, 38), '14 обращений · раз в 38 дней');
    assert.equal(objectHistory(14, undefined, 21), '14 обращений · раз в 21 день');
    assert.equal(objectHistory(1), '1 обращение');
  });

  it('поломки раскладываются по месяцам, а текущий месяц, последний', () => {
    const now = new Date('2026-09-12T09:00:00Z');
    const months = failuresByMonth(
      [
        { createdAt: '2026-09-01T10:00:00Z' },
        { createdAt: '2026-09-08T10:00:00Z' },
        { createdAt: '2026-02-14T10:00:00Z' },
      ],
      now,
    );

    assert.equal(months.length, 12);
    assert.equal(months[11], 2);
    assert.equal(months[4], 1);
  });

  it('подпись месяца стоит в одной колонке со своим столбиком', async () => {
    const { bridge } = createMockBridge();
    const now = new Date();
    const { api } = apiWith({
      '/api/objects': {
        startParam: 'lift-1',
        target: 'Лифт, подъезд 1',
        open: [],
        totalRequests: 4,
        history: [{ createdAt: now.toISOString() }, { createdAt: now.toISOString() }],
      },
    });

    const screen = await render(
      createElement(ObjectScreen as never, {
        api,
        startParam: 'lift-1',
        onReport: () => undefined,
        onOpenRequest: () => undefined,
      } as never),
      bridge,
    );

    const columns = screen.findAll('.year .month-column');

    assert.equal(columns.length, 12);
    assert.equal(
      columns.every((column) => column.querySelector('.month') !== null && column.querySelector('.month-name') !== null),
      true,
      'столбик и подпись стоят одной колонкой, иначе они разъезжаются',
    );

    const current = columns.at(-1);

    assert.ok(current?.className.includes('month-now'), 'у текущего месяца подписи не было');
    assert.equal(current?.querySelector('.month-name')?.textContent?.length, 3, 'одной буквы месяцы не различают');

    await screen.unmount();
  });

  it('то, что старше года, в полосу не попадает', () => {
    const now = new Date('2026-09-12T09:00:00Z');
    const months = failuresByMonth([{ createdAt: '2024-05-01T10:00:00Z' }], now);

    assert.deepEqual(
      months.filter((count) => count > 0),
      [],
    );
  });
});

describe('своя квартира', () => {
  it('документы продукта открываются из профиля своим экраном', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      '/api/me/notices': [],
      '/api/legal': {
        version: '2026-09-17',
        documents: [
          {
            slug: 'privacy',
            title: 'Политика обработки персональных данных',
            short: 'Политика обработки данных',
            about: 'О данных',
            text: 'Текст политики',
          },
        ],
      },
    });

    const opened: { title: string; text: string }[] = [];

    const screen = await render(
      createElement(ProfileScreen as never, {
        api,
        displayName: 'Мария',
        bound: true,
        onDocument: (title: string, text: string) => opened.push({ title, text }),
        onForgotten: () => undefined,
      } as never),
      bridge,
    );

    await screen.act(() => tap(screen, 'Политика обработки данных'));

    assert.equal(opened[0]?.title, 'Политика обработки персональных данных');
    assert.equal(opened[0]?.text, 'Текст политики');

    await screen.unmount();
  });

  it('отвязывается из профиля с подтверждением', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'POST /api/residents/res-1/unbind': { id: 'res-1' },
      '/api/me/notices': [],
    });

    let unbound = 0;

    const screen = await render(
      createElement(ProfileScreen as never, {
        api,
        displayName: 'Мария',
        bound: true,
        where: 'Квартира 1 · ул. Ленина, 15',
        flat: { residentId: 'res-1', apartmentId: 'apt-1', title: 'Квартиру 1' },
        onDocument: () => undefined,
        onForgotten: () => undefined,
        onUnbound: () => {
          unbound += 1;
        },
      } as never),
      bridge,
    );

    await screen.act(() => tap(screen, 'Отвязать квартиру'));

    assert.match(screen.text, /Отвязать квартиру 1\?/);
    assert.equal(calls.some((call) => call.path.includes('/unbind')), false, 'сначала спрашиваем');

    await screen.act(() => tap(screen, 'Отвязать'));

    assert.ok(calls.some((call) => call.path === '/api/residents/res-1/unbind' && call.method === 'POST'));
    assert.equal(unbound, 1, 'сессия перечитывается');

    await screen.unmount();
  });
});

describe('гостевые коды', () => {
  const DEVICES = [
    { id: 'intercom-1', title: 'Домофон, подъезд 1', kind: 'intercom', canOpen: true },
    { id: 'gate-1', title: 'Шлагбаум во двор', kind: 'gate', canOpen: true },
  ];

  it('выданные коды видно на экране дома и их отзывают кнопкой', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'POST /api/devices/guest-codes': {},
      '/api/devices/guest-codes': [
        { code: '174606', deviceId: 'gate-1', expiresAt: '2026-09-22T16:04:00.000Z' },
      ],
      '/api/devices': DEVICES,
      '/api/sensors': [],
    });

    const screen = await render(
      createElement(HomeScreen as never, {
        api,
        onCamera: () => undefined,
        onGuest: () => undefined,
        onJournal: () => undefined,
        onScan: () => undefined,
      } as never),
      bridge,
    );

    assert.match(screen.text, /Гостевые коды/);
    assert.match(screen.text, /174606/);
    assert.match(screen.text, /Шлагбаум во двор/);

    await screen.act(() => tap(screen, 'Отозвать'));

    assert.ok(
      calls.some((call) => call.path.includes('/guest-codes/174606/revoke') && call.method === 'POST'),
      'код отзывается тем же экраном',
    );

    await screen.unmount();
  });
});

describe('рассылка', () => {
  const TARGETS = {
    flats: 60,
    staff: 3,
    entrances: [
      { entrance: 1, flats: 30, risers: [{ riser: 1, flats: 15 }, { riser: 2, flats: 15 }] },
      { entrance: 2, flats: 30, risers: [{ riser: 1, flats: 30 }] },
    ],
    polls: [{ id: 'poll-1', title: 'Ремонт подъездов' }],
  };

  it('предлагает только те адресаты, которые в доме есть', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      'POST /api/broadcast/preview': { audience: 'весь дом', people: 40, recipients: 32, apartments: 60 },
      '/api/broadcast/targets': { ...TARGETS, entrances: [{ entrance: 1, flats: 30, risers: [{ riser: 1, flats: 30 }] }], polls: [], staff: 1 },
    });

    const screen = await render(
      createElement(Toasts as never, null, createElement(BroadcastScreen as never, { api } as never)),
      bridge,
    );

    assert.match(screen.text, /Весь дом/);
    assert.doesNotMatch(screen.text, /Подъезд/, 'в доме один подъезд');
    assert.doesNotMatch(screen.text, /Стояк/, 'в подъезде один стояк');
    assert.doesNotMatch(screen.text, /Не голосовали/, 'открытых собраний нет');

    await screen.unmount();
  });

  it('охват показывается до отправки, а отправка требует подтверждения', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'POST /api/broadcast/preview': { audience: 'весь дом', people: 40, recipients: 32, apartments: 60 },
      'POST /api/broadcast': { audience: 'весь дом', people: 40, recipients: 32, apartments: 60, sent: 32 },
      '/api/broadcast/targets': TARGETS,
    });

    const screen = await render(
      createElement(Toasts as never, null, createElement(BroadcastScreen as never, { api } as never)),
      bridge,
    );

    assert.match(screen.text, /весь дом ·\sполучат 32 человека из 40/);

    await screen.act(() => typeInto(screen.find('textarea'), 'Завтра отключат воду'));
    await screen.act(() => tap(screen, 'Отправить'));

    assert.match(screen.text, /Отправить рассылку\?/);
    assert.equal(calls.filter((call) => call.path === '/api/broadcast').length, 0, 'первое нажатие только спрашивает');

    await screen.act(() => tap(screen, 'Отправить'));

    const sent = calls.find((call) => call.path === '/api/broadcast');

    assert.equal(sent?.method, 'POST');
    assert.deepEqual(JSON.parse(sent?.body ?? '{}'), { kind: 'building', text: 'Завтра отключат воду' });
    assert.match(screen.text, /Отправлено: весь дом ·\s32 человека/);

    await screen.unmount();
  });

  it('стояк выбирается подъездом и номером', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      'POST /api/broadcast/preview': { audience: 'подъезд 1, стояк 2', people: 10, recipients: 10, apartments: 15 },
      '/api/broadcast/targets': TARGETS,
    });

    const screen = await render(
      createElement(Toasts as never, null, createElement(BroadcastScreen as never, { api } as never)),
      bridge,
    );

    await screen.act(() => tap(screen, 'Стояк'));
    await screen.act(() => tap(screen, 'Подъезд 1'));
    await screen.act(() => tap(screen, 'Стояк 2'));

    const asked = calls.filter((call) => call.path === '/api/broadcast/preview').at(-1);

    assert.deepEqual(JSON.parse(asked?.body ?? '{}'), { kind: 'riser', entrance: 1, riser: 2 });
    assert.match(screen.text, /подъезд 1, стояк 2 ·\sполучат 10 человек/);

    await screen.unmount();
  });

  it('без получателей отправка недоступна', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({
      'POST /api/broadcast/preview': { audience: 'должники дома', people: 2, recipients: 0, apartments: 2 },
      '/api/broadcast/targets': TARGETS,
    });

    const screen = await render(
      createElement(Toasts as never, null, createElement(BroadcastScreen as never, { api } as never)),
      bridge,
    );

    await screen.act(() => tap(screen, 'Должники'));

    assert.match(screen.text, /Никто из них не в MAX/);
    assert.equal(screen.findAll('button').filter((node) => node.textContent === 'Отправить')[0]?.hasAttribute('disabled'), true);

    await screen.unmount();
  });
});

describe('роль для проверки', () => {
  const ROLES = [
    { role: 'resident', title: 'Жилец', about: 'Заявки, показания, квитанция, собрания', current: true },
    { role: 'dispatcher', title: 'Диспетчер', about: 'Очередь дома, назначение мастера, рассылка', current: false },
    { role: 'manager', title: 'Управляющий', about: 'Дома компании, журнал действий, импорт', current: false },
  ];

  it('роль примеряется одним нажатием и сессия перечитывается', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/demo': ROLES, 'POST /api/demo': { role: 'dispatcher' } });

    let switched = 0;
    const screen = await render(
      createElement(
        Toasts as never,
        null,
        createElement(DemoScreen as never, { api, onSwitched: () => (switched += 1) } as never),
      ),
      bridge,
    );

    assert.match(screen.text, /Диспетчер/);

    await screen.act(() => tap(screen, 'Диспетчер'));

    assert.equal(calls.filter((call) => call.method === 'POST' && call.path === '/api/demo').length, 1);
    assert.equal(calls.find((call) => call.method === 'POST')?.body, JSON.stringify({ role: 'dispatcher' }));
    assert.equal(switched, 1);
    assert.match(screen.text, /Диспетчер/);

    await screen.unmount();
  });

  it('текущую роль не примеряют заново', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/demo': ROLES });

    const screen = await render(
      createElement(
        Toasts as never,
        null,
        createElement(DemoScreen as never, { api, onSwitched: () => undefined } as never),
      ),
      bridge,
    );

    await screen.act(() => tap(screen, 'Жилец'));

    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);

    await screen.unmount();
  });
});

describe('приём в управляющей организации', () => {
  const RECEPTION = {
    buildingId: 'b1',
    minutes: 30,
    hours: 'вторник 15:00-19:00',
    office: 'ул. Ленина, 15, офис 1',
    slots: [
      { at: '2026-09-22T10:00:00.000Z', day: '22 сентября', clock: '15:00' },
      { at: '2026-09-22T10:30:00.000Z', day: '22 сентября', clock: '15:30' },
      { at: '2026-09-24T10:00:00.000Z', day: '24 сентября', clock: '15:00' },
    ],
  };

  const VISIT = {
    id: 'vis-1',
    at: '2026-09-22T10:00:00.000Z',
    minutes: 30,
    topic: 'Перерасчёт за горячую воду',
    status: 'booked',
    day: '22 сентября',
    clock: '15:00',
  };

  it('жилец выбирает час и записывается', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/reception': RECEPTION, 'POST /api/visits': VISIT });

    const screen = await render(
      createElement(Toasts as never, null, createElement(VisitsScreen as never, { api } as never)),
      bridge,
    );

    assert.match(screen.text, /ул\. Ленина, 15, офис 1 · вторник 15:00-19:00/);
    assert.match(screen.text, /22 сентября/);
    assert.match(screen.text, /24 сентября/);

    await screen.act(() => tap(screen, '15:30'));
    await screen.act(() => typeInto(screen.find<HTMLInputElement>('#visit-topic'), 'Перерасчёт'));
    await screen.act(() => tap(screen, 'Записаться'));

    const post = calls.find((call) => call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { at: '2026-09-22T10:30:00.000Z', topic: 'Перерасчёт' });

    await screen.unmount();
  });

  it('своя запись показывается вместо часов', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/reception': { ...RECEPTION, mine: VISIT }, 'POST /api/visits': VISIT });

    const screen = await render(
      createElement(Toasts as never, null, createElement(VisitsScreen as never, { api } as never)),
      bridge,
    );

    assert.match(screen.text, /Вы записаны/);
    assert.match(screen.text, /22 сентября, 15:00/);
    assert.match(screen.text, /Перерасчёт за горячую воду/);

    await screen.act(() => tap(screen, 'Отменить запись'));

    assert.ok(
      calls.some((call) => call.method === 'POST' && call.path === '/api/visits/vis-1/cancel'),
      'отмена не ушла',
    );

    await screen.unmount();
  });

  it('без приёмных окон раздел говорит об этом', async () => {
    const { bridge } = createMockBridge();
    const { api } = apiWith({ '/api/reception': { buildingId: 'b1', minutes: 30, hours: '', slots: [] } });

    const screen = await render(
      createElement(Toasts as never, null, createElement(VisitsScreen as never, { api } as never)),
      bridge,
    );

    assert.match(screen.text, /Приём по записи не ведётся/);

    await screen.unmount();
  });

  it('смена видит, кто записался, и отмечает приём', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/visits': [{ ...VISIT, residentName: 'Мария', apartment: 1 }],
      'POST /api/visits/vis-1/done': { ...VISIT, status: 'done' },
    });

    const screen = await render(
      createElement(Toasts as never, null, createElement(VisitsScreen as never, { api, staff: true } as never)),
      bridge,
    );

    assert.match(screen.text, /22 сентября, 15:00 · Мария, кв\. 1/);

    await screen.act(() => tap(screen, 'Приём состоялся'));

    assert.ok(
      calls.some((call) => call.method === 'POST' && call.path === '/api/visits/vis-1/done'),
      'отметка не ушла',
    );

    await screen.unmount();
  });

  it('управляющий задаёт приёмные часы прямо на экране приёма', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/visits': [],
      'GET /api/reception': { buildingId: 'b1', minutes: 20, hours: '', slots: [] },
      'POST /api/reception': { buildingId: 'b1', minutes: 20, hours: 'вт 15:00-19:00', slots: [] },
      '/api/residents': [],
    });

    const screen = await render(
      createElement(Toasts as never, null, createElement(VisitsScreen as never, { api, staff: true, canSchedule: true } as never)),
      bridge,
    );
    await screen.act(() => {});

    assert.match(screen.text, /Часы приёма не заданы/);

    await screen.act(() => tap(screen, 'Задать часы'));
    await screen.act(() => typeInto(screen.find<HTMLInputElement>('[aria-label="До, окно 1"]'), '18:00'));
    await screen.act(() => tap(screen, 'Сохранить часы'));
    await screen.act(() => {});

    const post = calls.find((call) => call.path === '/api/reception' && call.method === 'POST');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { windows: [{ weekday: 2, from: '15:00', to: '18:00' }] });
    assert.match(screen.text, /вт 15:00-19:00/);

    await screen.unmount();
  });

  it('пришедшего без записи сотрудник заносит сам', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({
      '/api/visits': [],
      'GET /api/reception': { buildingId: 'b1', minutes: 20, hours: 'вт 15:00-19:00', slots: [] },
      '/api/residents': [{ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentNumber: 1 }],
      'POST /api/visits/record': { ...VISIT, residentName: 'Мария', apartment: 1 },
    });

    const screen = await render(
      createElement(Toasts as never, null, createElement(VisitsScreen as never, { api, staff: true } as never)),
      bridge,
    );
    await screen.act(() => {});

    await screen.act(() => tap(screen, 'Записать пришедшего'));

    await screen.act(() => {
      const select = screen.find<HTMLSelectElement>('#walk-in-resident');

      Object.getOwnPropertyDescriptor(globalThis.HTMLSelectElement.prototype, 'value')?.set?.call(select, 'res-1');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await screen.act(() => typeInto(screen.find<HTMLInputElement>('#walk-in-topic'), 'Перерасчёт'));
    await screen.act(() => tap(screen, 'Записать приём'));
    await screen.act(() => {});

    const post = calls.find((call) => call.path === '/api/visits/record');

    assert.deepEqual(JSON.parse(post?.body ?? '{}'), { residentId: 'res-1', topic: 'Перерасчёт' });

    await screen.unmount();
  });
});

describe('согласие с документами', () => {
  const LEGAL = {
    version: '2026-09-17',
    documents: [
      {
        slug: 'privacy',
        title: 'Политика обработки персональных данных',
        short: 'Политика обработки данных',
        about: 'О данных',
        text: 'Текст политики',
      },
      {
        slug: 'terms',
        title: 'Пользовательское соглашение',
        short: 'Пользовательское соглашение',
        about: 'Правила',
        text: 'Текст соглашения',
      },
    ],
  };

  it('документы открываются внутри приложения, а согласие уходит на сервер', async () => {
    const { bridge } = createMockBridge();
    const { api, calls } = apiWith({ '/api/legal': LEGAL, 'POST /api/me/legal': { version: LEGAL.version, accepted: true } });
    const opened: string[] = [];
    let accepted = 0;

    const screen = await render(
      createElement(Consent as never, {
        api,
        onDocument: (title: string) => opened.push(title),
        onAccepted: () => {
          accepted += 1;
        },
      } as never),
      bridge,
    );

    assert.match(screen.text, /Политика обработки данных/);
    assert.match(screen.text, /по поручению управляющей компании/);

    await screen.act(() => tap(screen, 'Политика обработки данных'));

    assert.deepEqual(opened, ['Политика обработки персональных данных'], 'документ открылся не своим экраном');
    assert.equal(
      calls.some((call) => call.path.includes('http')),
      false,
      'документ ушёл в браузер',
    );

    await screen.act(() => tap(screen, 'Принимаю'));

    const sent = calls.find((call) => call.path === '/api/me/legal');

    assert.equal(sent?.method, 'POST');
    assert.equal(accepted, 1, 'согласие не дошло до приложения');

    await screen.unmount();
  });
});
