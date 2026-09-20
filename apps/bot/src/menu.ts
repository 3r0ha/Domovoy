import { apartmentsOf, needsApartment, type Resident } from '@domovoy/app';
import { Keyboard } from '@maxkit/max-bot-api';

import type { Extra } from './kit.js';
import { ROOT_MENUS, SCREENS } from './max.js';

export interface MenuItem {
  title: string;
  command: string;
  /**
   * Дело живёт в мини-приложении: в переписке оно было бы мучительным.
   * Пункт остаётся в меню, чтобы человек о нём узнал, и открывает раздел.
   */
  app?: { screen: string; about: string };
  /** Кому пункт показывать. Пусто означает всем, кому досталось это меню. */
  roles?: readonly string[];
}

export interface MenuGroup {
  /** Ключ группы: он же приходит в нажатой кнопке. */
  key: string;
  title: string;
  /** Что здесь делают, одной строкой: заголовка группы человеку мало. */
  about?: string;
  items: MenuItem[];
}

interface RoleMenu {
  /** Что делают чаще всего: эти кнопки стоят на первом экране меню. */
  top: MenuItem[];
  groups: MenuGroup[];
}

/** Дела своей квартиры: они есть и у сотрудника, если он живёт в обслуживаемом доме. */
const HOME_GROUP: MenuGroup = {
  key: 'home',
  title: '🏡 Моя квартира',
  about: 'Ваши счета, счётчики и заявки по своей квартире.',
  items: [
    { title: '✍️ Новая заявка', command: 'new' },
    { title: '💧 Показания', command: 'meters' },
    { title: '🧾 Квитанция', command: 'bill' },
    { title: '🏢 Квартира', command: 'flat' },
    { title: '✉️ Вопрос компании', command: 'support' },
    {
      title: '🗓 Приём в офисе',
      command: 'visit',
      app: { screen: 'visits', about: 'Свободные часы, своя запись и её отмена.' },
    },
  ],
};

/**
 * То же для сотрудника без привязки: без этого пункта привязать свою квартиру
 * ему нечем, команда привязки живёт только внутри «Моей квартиры».
 */
const BIND_GROUP: MenuGroup = {
  key: 'home',
  title: '🏡 Моя квартира',
  about: 'Если вы живёте в этом доме, привяжите квартиру по коду из квитанции.',
  items: [{ title: '🏢 Моя квартира', command: 'flat' }],
};

const RESIDENT: RoleMenu = {
  top: [
    { title: '✍️ Что сломалось', command: 'new' },
    { title: '📋 Мои обращения', command: 'my' },
    // Двери открывают на ходу, стоя у подъезда: прятать их в группу значит
    // заставить человека нажимать дважды, пока за ним закрывается домофон.
    { title: '🚪 Двери и камеры', command: 'door' },
  ],
  groups: [
    {
      key: 'money',
      title: '💳 Деньги и счётчики',
      about: 'Сколько платить в этом месяце и куда отправить цифры со счётчиков.',
      items: [
        { title: '🧾 Сколько платить', command: 'bill' },
        { title: '💧 Счётчики', command: 'meters' },
      ],
    },
    {
      key: 'house',
      title: '📣 Новости дома',
      about: 'Объявления управляющей компании, собрания соседей и работа по дому.',
      items: [
        { title: '📣 Объявления', command: 'news' },
        {
          title: '🗳 Собрания',
          command: 'vote',
          app: {
            screen: 'polls',
            about: 'Голос по каждому вопросу, счёт по долям площади и протокол по итогам.',
          },
        },
        {
          title: '👥 Заявки соседей',
          command: 'neighbours',
          app: {
            screen: 'list',
            about: 'О чём уже сообщили соседи: можно подтвердить, что у вас то же самое.',
          },
        },
        { title: '📊 Работа компании', command: 'house' },
        {
          title: '🏗 Капитальный ремонт',
          command: 'capital',
          app: {
            screen: 'capital',
            about: 'Взнос, накопленное домом и годы работ по региональной программе.',
          },
        },
      ],
    },
    {
      key: 'me',
      title: '☎️ Связь и профиль',
      about: 'Как связаться с управляющей компанией и что продукт о вас знает.',
      items: [
        { title: '✉️ Вопрос компании', command: 'support' },
        {
          title: '🗓 Приём в офисе',
          command: 'visit',
          app: {
            screen: 'visits',
            about: 'Свободные часы на две недели вперёд, своя запись и её отмена.',
          },
        },
        { title: '☎️ Контакты', command: 'contacts' },
        { title: '🏢 Квартира', command: 'flat' },
        { title: '🗂 Мои данные', command: 'mydata' },
        {
          title: '🔔 Уведомления',
          command: 'notices',
          app: {
            screen: 'profile',
            about: 'Что присылать и о чём молчать. Там же телефон и выгрузка своих данных.',
          },
        },
      ],
    },
  ],
};

const CONTRACTOR: RoleMenu = {
  top: [
    { title: '📋 Наряды', command: 'my' },
    { title: '🗂 Мои данные', command: 'mydata' },
  ],
  groups: [
    {
      // Подрядчик приходит в дом со стороны, но дела дома ему тоже доступны:
      // спросить управляющую компанию, посмотреть объявления, открыть дверь.
      key: 'house',
      title: '🏢 Дела дома',
      about: 'Связь с управляющей компанией, объявления и двери подъездов.',
      items: [
        { title: '✉️ Вопрос компании', command: 'support' },
        { title: '☎️ Контакты', command: 'contacts' },
        { title: '📣 Объявления', command: 'news' },
        { title: '🚪 Двери и камеры', command: 'door' },
        { title: '🧾 Сколько платить', command: 'bill' },
        { title: '💧 Счётчики', command: 'meters' },
      ],
    },
  ],
};

const STAFF: RoleMenu = {
  top: [
    { title: '🗂 Очередь дома', command: 'queue' },
    { title: '📋 Мои наряды', command: 'my' },
    // Дежурство назначают диспетчер и управляющий, и управляющий тоже берёт
    // ночь на себя. Мастеру пункт не показывается: кнопка вела бы в отказ.
    { title: '🌙 Дежурство', command: 'duty', roles: ['dispatcher', 'manager'] },
  ],
  groups: [
    {
      key: 'people',
      title: '💬 Жильцы',
      about: 'Вопросы жильцов, приём по записи и сообщения дому.',
      items: [
        { title: '💬 Вопросы жильцов', command: 'support' },
        {
          title: '🗓 Приём жильцов',
          command: 'visit',
          app: {
            screen: 'visits',
            about: 'Часы приёма, записи жильцов, отметка о приёме и запись пришедшего без записи.',
          },
        },
        { title: '✉️ Рассылка', command: 'broadcast' },
        { title: '📣 Объявления', command: 'news' },
      ],
    },
    {
      key: 'house',
      title: '🏢 Дела дома',
      about: 'Как дом закрывает сроки, долги, собрания и двери подъездов.',
      items: [
        { title: '📊 Сводка за месяц', command: 'report' },
        // Рассылку должникам делают диспетчер и управляющий: мастеру суммы дома
        // в работе не нужны, а писать он по ним всё равно не может.
        { title: '💰 Долги дома', command: 'debts', roles: ['dispatcher', 'manager'] },
        {
          title: '🗳 Собрания',
          command: 'vote',
          app: {
            screen: 'polls',
            about: 'Объявить собрание, следить за кворумом и собрать протокол по итогам.',
          },
        },
        { title: '🚪 Двери и камеры', command: 'door' },
      ],
    },
    {
      // Сотрудник тоже живёт в квартире и сам пишет в управляющую компанию:
      // без этих пунктов ему пришлось бы вспоминать команды.
      key: 'me',
      title: '☎️ Связь и профиль',
      about: 'Своя квартира, данные, уведомления и связь с управляющей компанией как жильца.',
      items: [
        // Сотрудник платит за свою квартиру так же, как жилец: без этих пунктов
        // помощник называл ему раздел, в который нечем перейти.
        { title: '🧾 Сколько платить', command: 'bill' },
        { title: '💧 Счётчики', command: 'meters' },
        { title: '🗂 Мои данные', command: 'mydata' },
        { title: '☎️ Контакты', command: 'contacts' },
        {
          title: '🔔 Уведомления',
          command: 'notices',
          app: {
            screen: 'profile',
            about: 'Что присылать и о чём молчать. Там же телефон и выгрузка своих данных.',
          },
        },
      ],
    },
    {
      key: 'app',
      title: '📱 В приложении',
      about: 'Экраны, которые в переписке не читаются: обходы, план дома, приборы.',
      items: [
        {
          title: '🔍 Осмотры',
          command: 'inspections',
          app: {
            screen: 'inspections',
            about: 'Обход по чек-листу: пункты отмечаются на месте, найденное сразу становится заявкой.',
          },
        },
        {
          title: '🗺 План дома',
          command: 'plan',
          app: { screen: 'plan', about: 'Подъезды и стояки с отметками, где сообщили о проблеме.' },
        },
        {
          title: '🛗 Оборудование',
          command: 'equipment',
          app: { screen: 'equipment', about: 'Что отказывает чаще и что скоро потребует ремонта.' },
        },
        {
          title: '💧 Узел учёта',
          command: 'house-meters',
          app: { screen: 'house-meters', about: 'Общедомовой расход по месяцам, туда же вводят показания.' },
        },
        {
          title: '👥 Люди дома',
          command: 'residents',
          app: { screen: 'residents', about: 'Кто в смене, кто дежурит, кому какая роль, привязка квартиры жильцу.' },
        },
        { title: '🏷 Наклейки', command: 'stickers' },
      ],
    },
    {
      key: 'manage',
      title: '🗄 Управление домом',
      about: 'Тарифы, карточка дома, адреса компании и журнал действий.',
      items: [
        {
          title: '💵 Тарифы',
          command: 'tariffs',
          app: { screen: 'tariffs', about: 'Ставки, из которых складывается квитанция дома.' },
          roles: ['manager'],
        },
        {
          title: '🏠 Карточка дома',
          command: 'card',
          app: { screen: 'import', about: 'Контакты, приёмные часы, квартиры и оборудование дома.' },
          roles: ['manager'],
        },
        {
          title: '🏘 Дома компании',
          command: 'buildings',
          app: { screen: 'buildings', about: 'Все адреса компании: переключиться или завести новый.' },
          roles: ['manager'],
        },
        {
          title: '📜 Журнал действий',
          command: 'audit',
          app: { screen: 'audit', about: 'Кто и что сделал по дому: заявки, роли, показания, рассылки.' },
          roles: ['manager'],
        },
      ],
    },
  ],
};

/** Дела управляющей компании: мастеру и подрядчику они не поручены. */
const FOR_MANAGEMENT = new Set(['broadcast']);

const roleMenu = (role: string): RoleMenu =>
  role === 'resident' ? RESIDENT : role === 'contractor' ? CONTRACTOR : STAFF;

/** Что в этой установке подключено: чего нет, того нет и в меню. */
export interface MenuOffer {
  /** Домофон и датчики. */
  doors?: boolean;
  /** Режим проверки: в меню появляется примерка роли. */
  demo?: boolean;
}

/** Примерка роли: пункт стоит первым экраном, чтобы до него был один клик. */
const DEMO_ITEM: MenuItem = { title: '👥 Роль', command: 'demo' };

/** Жильцу без квартиры остаётся одно дело: привязать её. */
const BIND_ITEM: MenuItem = { title: '🏢 Квартира', command: 'flat' };

/** Какому пункту нужен поставщик, без которого он только выдаёт ошибку. */
const REQUIRES: Readonly<Record<string, keyof MenuOffer>> = { door: 'doors' };

const offered = (item: MenuItem, offer: MenuOffer): boolean => {
  const needs = REQUIRES[item.command];

  return needs === undefined || offer[needs] !== false;
};

/** Меню под роль: то, что человеку доступно, разложенное по группам. */
export const menuFor = (resident: Resident, offer: MenuOffer = {}): RoleMenu => {
  const role = resident.role;

  if (needsApartment(resident)) {
    return { top: offer.demo === true ? [BIND_ITEM, DEMO_ITEM] : [BIND_ITEM], groups: [] };
  }

  const own = roleMenu(role);
  const allowed = own.groups.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        offered(item, offer) &&
        (!item.roles || item.roles.includes(role)) &&
        !(role === 'technician' && FOR_MANAGEMENT.has(item.command)),
    ),
  }));

  const groups = [
    ...allowed,
    ...(role === 'resident' ? [] : [apartmentsOf(resident).length > 0 ? HOME_GROUP : BIND_GROUP]),
  ].filter((group) => group.items.length > 0);

  const top = own.top.filter(
    (item) => offered(item, offer) && (!item.roles || item.roles.includes(role)),
  );

  return { top: offer.demo === true ? [...top, DEMO_ITEM] : top, groups };
};

/** Группа по ключу: по ней собирается второй экран меню. */
export const groupFor = (resident: Resident, key: string, offer: MenuOffer = {}): MenuGroup | undefined =>
  menuFor(resident, offer).groups.find((group) => group.key === key);

/** Пункт, который живёт в приложении, нажимается иначе: он о нём и рассказывает. */
const payloadOf = (item: MenuItem): string => (item.app ? `app:${item.command}` : `menu:${item.command}`);

const rows = (items: readonly MenuItem[]): ReturnType<typeof Keyboard.button.callback>[][] => {
  const built: ReturnType<typeof Keyboard.button.callback>[][] = [];

  for (let at = 0; at < items.length; at += 2) {
    built.push(items.slice(at, at + 2).map((item) => Keyboard.button.callback(item.title, payloadOf(item))));
  }

  return built;
};

/** В какой группе лежит пункт. Пусто означает первый экран меню. */
export const groupWith = (resident: Resident, command: string, offer: MenuOffer = {}): string | undefined =>
  menuFor(resident, offer).groups.find((group) => group.items.some((item) => item.command === command))?.key;

/**
 * Пункт меню по имени: по нему собирается рассказ о разделе приложения. Частые
 * дела лежат на первом экране, а не в группах, и их тоже называет помощник.
 */
export const itemFor = (resident: Resident, command: string, offer: MenuOffer = {}): MenuItem | undefined => {
  const menu = menuFor(resident, offer);

  return [...menu.top, ...menu.groups.flatMap((group) => group.items)].find((item) => item.command === command);
};

/**
 * Первый экран меню: частые дела кнопками, остальное группами. Так в чате
 * лежит шесть кнопок, а не полтора десятка.
 */
export const menuKeyboard = (resident: Resident, miniAppUrl?: string, offer: MenuOffer = {}): Extra => {
  const menu = menuFor(resident, offer);

  const groups = menu.groups.map((group) => Keyboard.button.callback(group.title, `group:${group.key}`));
  const grouped: ReturnType<typeof Keyboard.button.callback>[][] = [];

  for (let at = 0; at < groups.length; at += 2) grouped.push(groups.slice(at, at + 2));

  const app = miniAppUrl ? [[Keyboard.button.openApp('📱 Открыть приложение', miniAppUrl)]] : [];

  const built = {
    attachments: [
      Keyboard.inlineKeyboard([
        ...rows(menu.top),
        ...grouped,
        ...app,
      ]),
    ],
  };

  ROOT_MENUS.add(built);
  SCREENS.add(built);

  return built;
};

/** Экран, который правится на месте: меню, группа, подсказка. */
const screenOf = (extra: Extra): Extra => {
  ROOT_MENUS.add(extra);
  SCREENS.add(extra);

  return extra;
};

/** Второй экран меню: пункты группы и возврат к первому. */
export const groupKeyboard = (group: MenuGroup): Extra => screenOf({
  attachments: [
    Keyboard.inlineKeyboard([...rows(group.items), [Keyboard.button.callback('🏠 Меню', 'group:back')]]),
  ],
});
