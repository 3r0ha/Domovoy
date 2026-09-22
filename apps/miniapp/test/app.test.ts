import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

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
const { App } = await import('../dist-test/App.js');

interface Profile {
  id: string;
  displayName: string;
  role: string;
  apartmentId: string | null;
  /** Язык человека. Пусто: язык ещё не выбран. */
  language?: string | null;
  /** Согласие с документами: до него продукт показывает их. */
  legal?: { version: string; accepted: boolean };
  /** Что подключено в этой установке: без поставщика раздела в панели нет. */
  doors?: boolean;
  payments?: boolean;
  reception?: boolean;
  files?: boolean;
  demo?: boolean;
}

/** Сервер, которого достаточно для входа. */
const server = (
  profile: Profile,
  buildings: { id: string; code: string; address: string; current: boolean }[] = [],
  requests: Record<string, unknown>[] = [],
  apartments: { id: string; number: number; buildingId: string; address: string; current: boolean }[] = [],
) => {
  const paths: string[] = [];

  const fetchStub = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace('http://api.test', '');

    paths.push(path);

    const body = path.startsWith('/auth/session')
      ? { token: 'tok-1', expiresAt: Date.now() + 3600_000, displayName: profile.displayName }
      : path.startsWith('/api/buildings')
        ? buildings
        : path.startsWith('/api/me/apartments')
        ? apartments
        : path.startsWith('/api/me')
        ? profile
        : path.startsWith('/api/requests')
          ? requests
          : path.startsWith('/api/objects')
          ? { startParam: 'ent_b1_1', target: 'подъезд 1', open: [], history: [], totalRequests: 0 }
          : path.startsWith('/api/context')
            ? { target: 'подъезд 1', audience: 'подъезд 1', buildingId: 'b1' }
            : [];

    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  };

  return { fetchStub, paths };
};

const render = async (fetchStub: typeof globalThis.fetch, startParam?: string) => {
  const { bridge, client } = createMockBridge(startParam === undefined ? {} : { startParam });
  const container = document.createElement('div');

  document.body.appendChild(container);

  const root = createRoot(container) as unknown as { render: (node: unknown) => void; unmount: () => void };

  await act(async () => {
    root.render(
      createElement(
        MaxProvider as never,
        { bridge, autoReady: false } as never,
        createElement(App as never, { baseUrl: 'http://api.test', fetch: fetchStub } as never),
      ),
    );
  });

  for (let step = 0; step < 5; step += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  return {
    get text(): string {
      return container.textContent ?? '';
    },
    /** Состояние системной кнопки «назад» в клиенте. */
    get backVisible(): boolean {
      return (client as { state: { backButtonVisible: boolean } }).state.backButtonVisible;
    },
    pressBack: (): void => (client as { pressBackButton: () => void }).pressBackButton(),
    tabs: (): string[] => [...container.querySelectorAll('.tabs button')].map((tab) => tab.textContent ?? ''),
    find: <T extends Element>(selector: string): T | null => container.querySelector<T>(selector),
    findAll: (selector: string): Element[] => [...container.querySelectorAll(selector)],
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

describe('стартовый экран приложения', () => {
  it('жильца без квартиры встречает привязка, и кроме неё, профиля и роли ничего нет', async () => {
    const { fetchStub, paths } = server({ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: null, demo: true });

    const screen = await render(fetchStub);

    assert.match(screen.text, /Код из квитанции/);
    assert.match(screen.text, /Профиль и документы/);
    assert.match(screen.text, /Роль/);
    assert.deepEqual(screen.tabs(), [], 'вкладок без квартиры нет');
    assert.equal(screen.find('[data-guide="assistant"]'), null, 'помощник до привязки закрыт');
    assert.doesNotMatch(screen.text, /Написать в поддержку/);
    assert.equal(
      paths.some((path) => path.startsWith('/api/requests') || path.startsWith('/api/house/contacts')),
      false,
      `лишние запросы: ${paths.join(', ')}`,
    );

    await screen.unmount();
  });

  it('без квартиры ссылка на объект ждёт привязки, а без режима проверки роли нет', async () => {
    const { fetchStub } = server({ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: null });

    const screen = await render(fetchStub, 'ent_b1_1');

    assert.match(screen.text, /Код из квитанции/);
    assert.doesNotMatch(screen.text, /подъезд 1/);
    assert.doesNotMatch(screen.text, /Роль/);
    assert.equal(screen.backVisible, false);

    await screen.unmount();
  });

  it('ссылка на стартовый экран не вешает над ним возврат на самого себя', async () => {
    const { fetchStub } = server({ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: 'apt-1' });

    const screen = await render(fetchStub, 'go-list');

    assert.equal(screen.find('.screen-title')?.textContent, 'Заявки');
    assert.equal(screen.findAll('.back-link').length, 0);
    assert.equal(screen.backVisible, false);

    await screen.unmount();
  });

  it('привязанного жильца, список его заявок', async () => {
    const { fetchStub } = server({ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: 'apt-1' });

    const screen = await render(fetchStub);

    assert.doesNotMatch(screen.text, /Код квартиры напечатан/);
    assert.equal(screen.tabs().includes('Квартира'), false, 'привязываться больше не нужно');
    assert.deepEqual(screen.tabs(), ['Заявки', 'Дом', 'Оплата', 'Новости', 'Ещё']);

    assert.match(screen.text, /Оставить заявку/);

    await screen.unmount();
  });

  it('«назад» возвращает на предыдущий экран, а не закрывает приложение', async () => {
    const { fetchStub } = server({ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: 'apt-1' });

    const screen = await render(fetchStub);

    assert.equal(screen.backVisible, false, 'из корня возвращаться некуда');

    const create = screen.findAll('button').find((button) => button.textContent === 'Оставить заявку');

    assert.ok(create, 'кнопки «оставить заявку» нет');

    await screen.act(() => (create as HTMLButtonElement).click());

    assert.match(screen.text, /Новая заявка/);
    assert.equal(screen.backVisible, true, 'вглубь ушли, кнопка нужна');

    await screen.act(() => screen.pressBack());

    assert.doesNotMatch(screen.text, /Новая заявка/);
    assert.equal(screen.backVisible, false);

    await screen.unmount();
  });

  it('без домофона раздела «Дом» в приложении нет', async () => {
    const { fetchStub } = server({
      id: 'res-1',
      displayName: 'Мария',
      role: 'resident',
      apartmentId: 'apt-1',
      doors: false,
    });

    const screen = await render(fetchStub);

    assert.equal(screen.tabs().includes('Дом'), false, `вкладки: ${screen.tabs().join(', ')}`);

    await screen.unmount();
  });

  it('переход по коду с наклейки ведёт к объекту, а не к пустой форме', async () => {
    const { fetchStub } = server({ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: 'apt-1' });

    const screen = await render(fetchStub, 'ent_b1_1');

    assert.match(screen.text, /подъезд 1/);
    assert.match(screen.text, /Сообщить о поломке/);
    assert.doesNotMatch(screen.text, /Квартира не привязана/);

    assert.equal(screen.backVisible, true);

    await screen.unmount();
  });

  it('подрядчик начинает со своих нарядов: очереди дома у него нет', async () => {
    const { fetchStub } = server({ id: 'con-1', displayName: 'Лифтсервис', role: 'contractor', apartmentId: null });

    const screen = await render(fetchStub);

    assert.deepEqual(screen.tabs(), ['Наряды', 'Профиль', 'Квартира']);
    assert.equal(screen.find('.screen-title')?.textContent, 'Наряды');
    assert.equal(screen.findAll('.tabs .tab-active').length, 1);

    await screen.unmount();
  });

  it('ссылка на чужой раздел объясняет, а не показывает пустую страницу', async () => {
    const { fetchStub } = server({ id: 'con-1', displayName: 'Лифтсервис', role: 'contractor', apartmentId: null });

    const screen = await render(fetchStub, 'go-queue');

    assert.match(screen.text, /Раздел недоступен/);

    await screen.unmount();
  });

  it('подрядчик со своей квартирой получает и жилищные разделы, но не дом заказчика', async () => {
    const { fetchStub } = server({ id: 'con-1', displayName: 'Лифтсервис', role: 'contractor', apartmentId: 'apt-1' });

    const screen = await render(fetchStub);
    const tabs = screen.tabs();

    assert.equal(tabs.includes('Оплата'), true, `вкладки: ${tabs.join(', ')}`);
    assert.equal(tabs.includes('Очередь'), false);
    assert.equal(tabs.includes('Дом'), false);

    await screen.unmount();
  });

  it('у сотрудника с двумя квартирами в шапке дом на работе и квартира на своих экранах', async () => {
    const { fetchStub } = server(
      { id: 'disp-1', displayName: 'Ольга', role: 'dispatcher', apartmentId: 'apt-17', demo: true },
      [
        { id: 'b1', code: 'Д15', address: 'ул. Ленина, 15', current: true },
        { id: 'b2', code: 'Д17', address: 'ул. Ленина, 17', current: false },
      ],
      [],
      [
        { id: 'apt-17', number: 17, buildingId: 'b2', address: 'ул. Ленина, 17', current: true },
        { id: 'apt-18', number: 18, buildingId: 'b2', address: 'ул. Ленина, 17', current: false },
      ],
    );

    const screen = await render(fetchStub);

    assert.equal(screen.find('select.building')?.getAttribute('aria-label'), 'Дом');

    await screen.act(() => {
      (screen.findAll('.tabs button').at(-1) as HTMLButtonElement).click();
    });

    await screen.act(() => {
      const polls = screen.findAll('.tile-grid button, [class*=CellSimple__n]').find((node) =>
        (node.textContent ?? '').includes('Голосования и предложения'),
      );

      (polls as HTMLElement | undefined)?.click();
    });

    assert.equal(screen.find('select.building')?.getAttribute('aria-label'), 'Квартира');

    await screen.unmount();
  });

  it('мастер начинает со своих нарядов, а не с очереди дома', async () => {
    const { fetchStub } = server({ id: 'tech-1', displayName: 'Сергей', role: 'technician', apartmentId: null });

    const screen = await render(fetchStub);

    assert.deepEqual(screen.tabs(), ['Наряды', 'Мой день', 'Очередь', 'Дом', 'Ещё']);
    assert.match(screen.text, /Ваши наряды|Нарядов нет/);

    await screen.unmount();
  });

  it('сотрудник начинает со смены, а редкое лежит в «Ещё»', async () => {
    const { fetchStub } = server({ id: 'disp-1', displayName: 'Ольга', role: 'dispatcher', apartmentId: null });

    const screen = await render(fetchStub);
    const tabs = screen.tabs();

    assert.deepEqual(tabs, ['Очередь', 'Наряды', 'Дом', 'Новости', 'Ещё']);
    assert.equal(tabs.includes('Квартира'), false);

    await screen.act(() => {
      const more = screen.findAll('.tabs button').at(-1);

      (more as HTMLButtonElement).click();
    });

    assert.match(screen.text, /Сводка/);
    assert.match(screen.text, /Люди дома/);
    assert.match(screen.text, /Смена/, 'разделов у смены много, поэтому они по группам');
    assert.match(screen.text, /Управление/);
    assert.match(screen.text, /Профиль/);
    assert.doesNotMatch(screen.text, /Ваша квитанция/);

    await screen.unmount();
  });

  it('в рабочем меню смены нет ни жильцовых разделов, ни примерки роли', async () => {
    const { fetchStub } = server({ id: 'disp-1', displayName: 'Ольга', role: 'dispatcher', apartmentId: 'apt-3' });

    const screen = await render(fetchStub);

    await screen.act(() => {
      (screen.findAll('.tabs button').at(-1) as HTMLButtonElement).click();
    });

    assert.doesNotMatch(screen.text, /Собрания/);
    assert.doesNotMatch(screen.text, /Ваша квитанция/);
    assert.doesNotMatch(screen.text, /Работа дома/);
    assert.doesNotMatch(screen.text, /Моя квартира|Добавить квартиру/);
    assert.doesNotMatch(screen.text, /Посмотреть продукт другой стороной/);

    await screen.unmount();
  });

  it('в режиме показа сотруднику возвращают и свою квартиру, и примерку роли', async () => {
    const { fetchStub } = server({
      id: 'disp-1',
      displayName: 'Ольга',
      role: 'dispatcher',
      apartmentId: 'apt-3',
      demo: true,
    });

    const screen = await render(fetchStub);

    await screen.act(() => {
      (screen.findAll('.tabs button').at(-1) as HTMLButtonElement).click();
    });

    assert.match(screen.text, /Ваша квитанция/);
    assert.match(screen.text, /Добавить квартиру/);
    assert.match(screen.text, /Собрания/);
    assert.match(screen.text, /Посмотреть продукт другой стороной/);

    await screen.unmount();
  });

  it('с одним домом выбирать нечего', async () => {
    const { fetchStub } = server({ id: 'disp-1', displayName: 'Ольга', role: 'dispatcher', apartmentId: null }, [
      { id: 'b1', code: 'Д15', address: 'ул. Ленина, 15', current: true },
    ]);

    const screen = await render(fetchStub);

    assert.equal(screen.find('select.building'), null);

    await screen.unmount();
  });

  it('сотрудник переключает дом, и списки читаются заново', async () => {
    const { fetchStub, paths } = server(
      { id: 'disp-1', displayName: 'Ольга', role: 'dispatcher', apartmentId: null },
      [
        { id: 'b1', code: 'Д15', address: 'ул. Ленина, 15', current: true },
        { id: 'b2', code: 'Д17', address: 'ул. Ленина, 17', current: false },
      ],
    );

    const screen = await render(fetchStub);
    const select = screen.find<HTMLSelectElement>('select.building');

    assert.ok(select, 'переключателя дома нет');
    assert.deepEqual(
      [...select.options].map((option) => option.textContent),
      ['Д15 · ул. Ленина, 15', 'Д17 · ул. Ленина, 17'],
    );

    const before = paths.length;

    await screen.act(() => {
      select.value = 'b2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    assert.ok(
      paths.slice(before).some((path) => path.includes('buildingId=b2')),
      `после переключения не перечитали: ${paths.slice(before).join(', ')}`,
    );

    await screen.unmount();
  });

  it('жилец с одной квартирой переключателя не видит', async () => {
    const { fetchStub } = server(
      { id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: 'apt-1' },
      [],
      [],
      [{ id: 'apt-1', number: 1, buildingId: 'b1', address: 'ул. Ленина, 15', current: true }],
    );

    const screen = await render(fetchStub);

    assert.equal(screen.find('select.building'), null);

    await screen.unmount();
  });

  it('жилец с двумя квартирами выбирает, по какой смотреть', async () => {
    const { fetchStub, paths } = server(
      { id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: 'apt-1' },
      [],
      [],
      [
        { id: 'apt-1', number: 1, buildingId: 'b1', address: 'ул. Ленина, 15', current: true },
        { id: 'apt-20', number: 20, buildingId: 'b2', address: 'ул. Мира, 3', current: false },
      ],
    );

    const screen = await render(fetchStub);
    const select = screen.find<HTMLSelectElement>('select.building');

    assert.ok(select, 'переключателя квартиры нет');
    assert.deepEqual(
      [...select.options].map((option) => option.textContent),
      ['кв. 1 · ул. Ленина, 15', 'кв. 20 · ул. Мира, 3'],
    );

    const before = paths.length;

    await screen.act(() => {
      select.value = 'apt-20';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    assert.ok(
      paths.slice(before).some((path) => path === '/api/me/apartment/use'),
      `выбор квартиры не ушёл на сервер: ${paths.slice(before).join(', ')}`,
    );

    await screen.unmount();
  });
});

describe('значок на вкладке', () => {
  const request = (fields: Record<string, unknown>): Record<string, unknown> => ({
    id: 'req-1',
    number: 'Д15-1',
    category: 'plumbing',
    categoryTitle: 'Водоснабжение',
    priority: 'normal',
    status: 'in_progress',
    title: 'Течёт кран',
    description: 'Течёт кран',
    target: 'квартира 1',
    createdAt: '2026-09-03T10:00:00Z',
    reactionDueAt: '2026-09-03T10:30:00Z',
    resolutionDueAt: '2026-09-04T10:00:00Z',
    dueAt: '2026-09-04T10:00:00Z',
    overdue: false,
    reactionOverdue: false,
    reporters: 1,
    incident: false,
    reopenCount: 0,
    attachments: [],
    history: [],
    ...fields,
  });

  const badge = (screen: { find: <T extends Element>(selector: string) => T | null }): string | null =>
    screen.find<HTMLElement>('.badge-count')?.textContent ?? null;

  it('жильцу считает то, что ждёт его: уточнение и приёмку', async () => {
    const { fetchStub } = server({ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: 'apt-1' }, [], [
      request({ id: 'a', status: 'needs_info' }),
      request({ id: 'b', status: 'done' }),
      request({ id: 'c', status: 'in_progress' }),
    ]);

    const screen = await render(fetchStub);

    assert.equal(badge(screen), '2');

    await screen.unmount();
  });

  it('диспетчеру, новые и просроченные по дому', async () => {
    const { fetchStub } = server({ id: 'disp-1', displayName: 'Ольга', role: 'dispatcher', apartmentId: null }, [], [
      request({ id: 'a', status: 'new' }),
      request({ id: 'b', status: 'in_progress', overdue: true }),
      request({ id: 'c', status: 'in_progress' }),
    ]);

    const screen = await render(fetchStub);

    assert.equal(badge(screen), '2');

    await screen.unmount();
  });

  it('мастеру, только то, по чему уходит срок у него', async () => {
    const { fetchStub } = server({ id: 'tech-1', displayName: 'Сергей', role: 'technician', apartmentId: null }, [], [
      request({ id: 'a', status: 'new' }),
      request({ id: 'b', status: 'in_progress', overdue: true }),
    ]);

    const screen = await render(fetchStub);

    assert.equal(badge(screen), '1');

    await screen.unmount();
  });

  it('когда ничего не ждёт, значка нет', async () => {
    const { fetchStub } = server({ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: 'apt-1' }, [], [
      request({ id: 'a', status: 'in_progress' }),
    ]);

    const screen = await render(fetchStub);

    assert.equal(badge(screen), null);

    await screen.unmount();
  });
});

describe('сервер недоступен', () => {
  it('вход отказывает по-русски, а не сообщением браузера', async () => {
    const failing = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));

    const screen = await render(failing);

    assert.match(screen.text, /Не получилось войти/);
    assert.match(screen.text, /Нет связи с сервером/);
    assert.doesNotMatch(screen.text, /Failed to fetch/);
    assert.ok(
      screen.findAll('button').some((button) => button.textContent === 'Попробовать снова'),
      'нет кнопки повтора',
    );

    await screen.unmount();
  });
});

describe('без канала доставки файлов раздела наклеек нет', () => {
  it('наклейки видны только там, где файл дойдёт до переписки', async () => {
    const { layoutSections, offeredScreen } = await import('../dist-test/sections.js');

    const withFiles = layoutSections('manager', true, { files: true });
    const without = layoutSections('manager', true, { files: false });

    assert.equal(
      withFiles.everything.some((section) => section.screen === 'stickers'),
      true,
    );
    assert.equal(
      without.everything.some((section) => section.screen === 'stickers'),
      false,
    );
    assert.equal(offeredScreen('stickers', { files: false }), false);
  });
});

describe('тур первого входа', () => {
  it('до привязки квартиры не идёт: за вкладками ещё пусто', async () => {
    globalThis.localStorage.clear();

    const { fetchStub } = server({ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: null });
    const screen = await render(fetchStub);

    assert.equal(screen.findAll('.tour').length, 0);
    assert.match(screen.text, /Код из квитанции/);

    await screen.unmount();
  });

  it('привязанного жильца встречает сразу', async () => {
    globalThis.localStorage.clear();

    const { fetchStub } = server({ id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: 'apt-1' });
    const screen = await render(fetchStub);

    assert.equal(screen.findAll('.tour').length, 1);

    await screen.unmount();
  });
});

describe('язык мини-приложения', () => {
  const resident = (fields: Partial<Profile>): Profile => ({
    id: 'res-1',
    displayName: 'Мария',
    role: 'resident',
    apartmentId: 'apt-1',
    ...fields,
  });

  /** Нажатие по подписи: разметка кита меняется, а слова на экране остаются. */
  const tap = (screen: { findAll: (selector: string) => Element[] }, text: string): void => {
    const found = screen
      .findAll('button, a, [class*="Tappable"]')
      .filter((node) => (node.textContent ?? '').includes(text))
      .at(-1);

    assert.ok(found, `нечего нажать: «${text}»`);
    (found as HTMLElement).click();
  };

  /** Языки с отметкой: в списке помечен тот, на котором человек читает. */
  const marked = (screen: { findAll: (selector: string) => Element[] }): string[] =>
    screen
      .findAll('[class*="Tappable"]')
      .filter((node) => node.querySelector('svg') !== null)
      .map((node) => node.textContent ?? '');

  it('на первом входе язык спрашивают раньше документов', async () => {
    globalThis.localStorage.clear();

    const { fetchStub, paths } = server(
      resident({ language: null, legal: { version: '2026-09-01', accepted: false } }),
    );

    const screen = await render(fetchStub);

    assert.match(screen.text, /Выберите язык/u, 'вопрос виден и тем, кто по-русски не читает');
    assert.match(screen.text, /Choose your language/u);
    assert.match(screen.text, /English/);
    assert.match(screen.text, /Oʻzbekcha/);
    assert.doesNotMatch(screen.text, /Принимаю/, 'документы идут после языка');

    await screen.act(() => tap(screen, 'English'));

    assert.ok(
      paths.some((path) => path === '/api/me/language'),
      `выбор языка не ушёл на сервер: ${paths.join(', ')}`,
    );
    assert.match(screen.text, /I accept/u, 'после языка спрашивают согласие, и уже на выбранном языке');

    await screen.unmount();
  });

  it('сотрудника о языке не спрашивают', async () => {
    globalThis.localStorage.clear();

    const { fetchStub } = server({
      id: 'disp-1',
      displayName: 'Ольга',
      role: 'dispatcher',
      apartmentId: null,
      language: null,
      legal: { version: '2026-09-01', accepted: false },
    });

    const screen = await render(fetchStub);

    assert.doesNotMatch(screen.text, /Oʻzbekcha/);
    assert.match(screen.text, /Принимаю/);

    await screen.unmount();
  });

  it('раздел «Язык» открыт жильцу без квартиры, и выбор меняет язык', async () => {
    globalThis.localStorage.clear();

    const { fetchStub, paths } = server(resident({ apartmentId: null, language: 'ru' }));

    const screen = await render(fetchStub);

    assert.match(screen.text, /Код из квитанции/);
    assert.match(screen.text, /Язык/, 'до привязки язык тоже меняют');

    await screen.act(() => tap(screen, 'Интерфейс и сообщения от дома'));

    assert.match(screen.text, /Татарча/);
    assert.deepEqual(marked(screen), ['Русский'], 'текущий язык помечен');

    await screen.act(() => tap(screen, 'English'));

    assert.ok(
      paths.some((path) => path === '/api/me/language'),
      `выбор языка не ушёл на сервер: ${paths.join(', ')}`,
    );
    assert.deepEqual(marked(screen), ['English'], 'язык в приложении сменился');

    await screen.unmount();
  });
});

describe('раздел проверки', () => {
  it('в обычной установке его нет, в режиме проверки он последний', async () => {
    const { layoutSections, offeredScreen } = await import('../dist-test/sections.js');

    const usual = layoutSections('resident', true, { doors: true });
    const checking = layoutSections('resident', true, { doors: true, demo: true });

    assert.equal(
      usual.everything.some((section) => section.screen === 'demo'),
      false,
    );
    assert.equal(checking.everything.at(-1)?.screen, 'demo');
    assert.equal(offeredScreen('demo', { doors: true }), false);
    assert.equal(offeredScreen('demo', { demo: true }), true);
  });
});
