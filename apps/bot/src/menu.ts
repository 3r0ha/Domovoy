import { apartmentsOf, type Resident } from '@domovoy/app';
import { Keyboard } from '@maxkit/max-bot-api';

import type { Extra } from './kit.js';

export interface MenuItem {
  title: string;
  command: string;
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

const RESIDENT: RoleMenu = {
  top: [
    { title: '✍️ Новая заявка', command: 'new' },
    { title: '📋 Заявки', command: 'my' },
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
        { title: '📄 Документы', command: 'legal' },
      ],
    },
  ],
};

const CONTRACTOR: RoleMenu = {
  top: [
    { title: '📋 Наряды', command: 'my' },
    { title: '🗂 Мои данные', command: 'mydata' },
  ],
  groups: [],
};

const STAFF: RoleMenu = {
  top: [
    { title: '📋 Заявки', command: 'my' },
    { title: '🌙 Дежурство', command: 'duty' },
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
        { title: '📄 Документы', command: 'legal' },
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
      ],
    },
  ],
};

/** Дела управляющей компании: мастеру и подрядчику они не поручены. */
const FOR_MANAGEMENT = new Set(['broadcast']);

/** Только управляющий: чат дома привязывает он. Отдельной группы ради одного пункта нет. */
const MANAGER_ITEM: MenuItem = { title: '🔗 Чат дома', command: 'here' };

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
      (item) => offered(item, offer) && !(role === 'technician' && FOR_MANAGEMENT.has(item.command)),
    ),
  }));

  const groups = [
    ...allowed.map((group) =>
      group.key === 'shift' && role === 'manager' ? { ...group, items: [...group.items, MANAGER_ITEM] } : group,
    ),
    ...(role !== 'resident' && apartmentsOf(resident).length > 0 ? [HOME_GROUP] : []),
  ].filter((group) => group.items.length > 0);

  const top = own.top.filter((item) => offered(item, offer));

  return { top: offer.demo === true ? [...top, DEMO_ITEM] : top, groups };
};

/** Группа по ключу: по ней собирается второй экран меню. */
export const groupFor = (resident: Resident, key: string, offer: MenuOffer = {}): MenuGroup | undefined =>
  menuFor(resident, offer).groups.find((group) => group.key === key);

const rows = (items: readonly MenuItem[]): ReturnType<typeof Keyboard.button.callback>[][] => {
  const built: ReturnType<typeof Keyboard.button.callback>[][] = [];

  for (let at = 0; at < items.length; at += 2) {
    built.push(items.slice(at, at + 2).map((item) => Keyboard.button.callback(item.title, `menu:${item.command}`)));
  }

  return built;
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

  return { attachments: [Keyboard.inlineKeyboard([...rows(menu.top), ...grouped, ...app])] };
};

/** Второй экран меню: пункты группы и возврат к первому. */
export const groupKeyboard = (group: MenuGroup): Extra => ({
  attachments: [
    Keyboard.inlineKeyboard([...rows(group.items), [Keyboard.button.callback('⬅️ Назад', 'group:back')]]),
  ],
});
