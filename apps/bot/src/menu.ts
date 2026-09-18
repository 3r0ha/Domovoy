import { apartmentsOf, type Resident } from '@domovoy/app';
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
  title: '🏡 Своё',
  items: [
    { title: '✍️ Новая заявка', command: 'new' },
    { title: '💧 Показания', command: 'meters' },
    { title: '🧾 Квитанция', command: 'bill' },
    { title: '🏢 Квартира', command: 'flat' },
  ],
};

/** Помощник стоит первым экраном у всех: спросить словами проще, чем искать пункт. */
const ASK_ITEM: MenuItem = { title: '❓ Спросить', command: 'help' };

const RESIDENT: RoleMenu = {
  top: [
    { title: '✍️ Новая заявка', command: 'new' },
    { title: '📋 Заявки', command: 'my' },
    ASK_ITEM,
  ],
  groups: [
    {
      key: 'money',
      title: '💳 Оплата',
      items: [
        { title: '🧾 Квитанция', command: 'bill' },
        { title: '💧 Показания', command: 'meters' },
      ],
    },
    {
      key: 'house',
      title: '🏢 Дом',
      items: [
        { title: '🚪 Дверь', command: 'door' },
        { title: '📣 Объявления', command: 'news' },
        { title: '👥 Соседи', command: 'neighbours' },
        { title: '🗳 Собрания', command: 'vote' },
        { title: '📊 Работа дома', command: 'house' },
        {
          title: '🏗 Капремонт',
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
      title: '👤 Ещё',
      items: [
        { title: '💬 Поддержка', command: 'support' },
        { title: '🗓 Приём', command: 'visit' },
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
    ASK_ITEM,
  ],
  groups: [],
};

const STAFF: RoleMenu = {
  top: [
    { title: '📋 Заявки', command: 'my' },
    { title: '🗂 Очередь', command: 'queue' },
    { title: '🌙 Дежурство', command: 'duty' },
    ASK_ITEM,
  ],
  groups: [
    {
      key: 'shift',
      title: '🧰 Смена',
      items: [
        { title: '💬 Поддержка', command: 'support' },
        { title: '🗓 Приём', command: 'visit' },
        { title: '📊 Сводка', command: 'report' },
        { title: '🏷 Наклейки', command: 'stickers' },
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
      ],
    },
    {
      key: 'house',
      title: '🏢 Дом',
      items: [
        { title: '📣 Объявления', command: 'news' },
        { title: '✉️ Рассылка', command: 'broadcast' },
        { title: '🗳 Собрания', command: 'vote' },
        { title: '🚪 Дверь', command: 'door' },
        { title: '💰 Долги', command: 'debts' },
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
      ],
    },
    {
      key: 'manage',
      title: '🗄 Управление',
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
          title: '📜 Действия',
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

/** Какому пункту нужен поставщик, без которого он только выдаёт ошибку. */
const REQUIRES: Readonly<Record<string, keyof MenuOffer>> = { door: 'doors' };

const offered = (item: MenuItem, offer: MenuOffer): boolean => {
  const needs = REQUIRES[item.command];

  return needs === undefined || offer[needs] !== false;
};

/** Меню под роль: то, что человеку доступно, разложенное по группам. */
export const menuFor = (resident: Resident, offer: MenuOffer = {}): RoleMenu => {
  const role = resident.role;
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
    ...(role !== 'resident' && apartmentsOf(resident).length > 0 ? [HOME_GROUP] : []),
  ].filter((group) => group.items.length > 0);

  const top = own.top.filter((item) => offered(item, offer));

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

/** Пункт меню по имени: по нему собирается рассказ о разделе приложения. */
export const itemFor = (resident: Resident, command: string, offer: MenuOffer = {}): MenuItem | undefined =>
  menuFor(resident, offer)
    .groups.flatMap((group) => group.items)
    .find((item) => item.command === command);

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

  const built = { attachments: [Keyboard.inlineKeyboard([...rows(menu.top), ...grouped, ...app])] };

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
