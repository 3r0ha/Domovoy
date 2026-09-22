import { apartmentsOf, knowsHouse, needsApartment, type Resident } from '@domovoy/app';
import type { Translate } from '@domovoy/i18n';
import { Keyboard } from '@maxkit/max-bot-api';

import { RU } from './i18n.js';
import type { Extra } from './kit.js';
import { ROOT_MENUS, SCREENS } from './max.js';

export interface MenuItem {
  /** Подпись пункта: ключ перевода, а не готовая строка. */
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
  title: 'menu.group.home',
  items: [
    { title: 'menu.home.new', command: 'new' },
    { title: 'menu.home.meters', command: 'meters' },
    { title: 'menu.home.bill', command: 'bill' },
    { title: 'menu.flat', command: 'flat' },
    { title: 'menu.support', command: 'support' },
    {
      title: 'menu.visit',
      command: 'visit',
      app: { screen: 'visits', about: 'menu.home.visit.about' },
    },
  ],
};

/**
 * То же для сотрудника без привязки: без этого пункта привязать свою квартиру
 * ему нечем, команда привязки живёт только внутри «Моей квартиры».
 */
const BIND_GROUP: MenuGroup = {
  key: 'home',
  title: 'menu.group.home',
  about: 'menu.group.bind.about',
  items: [{ title: 'menu.home.flat', command: 'flat' }],
};

const RESIDENT: RoleMenu = {
  top: [
    { title: 'menu.new', command: 'new' },
    { title: 'menu.my', command: 'my' },
    // Двери открывают на ходу, стоя у подъезда: прятать их в группу значит
    // заставить человека нажимать дважды, пока за ним закрывается домофон.
    { title: 'menu.door', command: 'door' },
  ],
  groups: [
    {
      key: 'money',
      title: 'menu.group.money',
      items: [
        { title: 'menu.bill', command: 'bill' },
        { title: 'menu.meters', command: 'meters' },
      ],
    },
    {
      key: 'house',
      title: 'menu.group.house',
      items: [
        { title: 'menu.news', command: 'news' },
        {
          title: 'menu.vote',
          command: 'vote',
          app: { screen: 'polls', about: 'menu.vote.about' },
        },
        {
          title: 'menu.neighbours',
          command: 'neighbours',
          app: { screen: 'list', about: 'menu.neighbours.about' },
        },
        { title: 'menu.house', command: 'house' },
        {
          title: 'menu.capital',
          command: 'capital',
          app: { screen: 'capital', about: 'menu.capital.about' },
        },
      ],
    },
    {
      key: 'me',
      title: 'menu.group.me',
      items: [
        { title: 'menu.support', command: 'support' },
        {
          title: 'menu.visit',
          command: 'visit',
          app: { screen: 'visits', about: 'menu.visit.about' },
        },
        { title: 'menu.contacts', command: 'contacts' },
        { title: 'menu.flat', command: 'flat' },
        { title: 'menu.mydata', command: 'mydata' },
        {
          title: 'menu.notices',
          command: 'notices',
          app: { screen: 'profile', about: 'menu.notices.about' },
        },
        { title: 'menu.lang', command: 'lang' },
      ],
    },
  ],
};

const CONTRACTOR: RoleMenu = {
  top: [
    { title: 'menu.contractor.my', command: 'my' },
    { title: 'menu.mydata', command: 'mydata' },
  ],
  groups: [
    {
      // Подрядчик приходит в дом со стороны, но дела дома ему тоже доступны:
      // спросить управляющую организацию, посмотреть объявления, открыть дверь.
      key: 'house',
      title: 'menu.group.works',
      items: [
        { title: 'menu.support', command: 'support' },
        { title: 'menu.contacts', command: 'contacts' },
        { title: 'menu.news', command: 'news' },
        { title: 'menu.door', command: 'door' },
        { title: 'menu.bill', command: 'bill' },
        { title: 'menu.meters', command: 'meters' },
      ],
    },
  ],
};

const STAFF: RoleMenu = {
  top: [
    { title: 'menu.staff.queue', command: 'queue' },
    { title: 'menu.staff.day', command: 'day' },
    { title: 'menu.staff.my', command: 'my' },
    // Дежурство назначают диспетчер и управляющий, и управляющий тоже берёт
    // ночь на себя. Мастеру пункт не показывается: кнопка вела бы в отказ.
    { title: 'menu.staff.duty', command: 'duty', roles: ['dispatcher', 'manager'] },
  ],
  groups: [
    {
      key: 'people',
      title: 'menu.group.people',
      items: [
        { title: 'menu.staff.support', command: 'support' },
        {
          title: 'menu.staff.visit',
          command: 'visit',
          app: { screen: 'visits', about: 'menu.staff.visit.about' },
        },
        { title: 'menu.staff.broadcast', command: 'broadcast' },
        { title: 'menu.news', command: 'news' },
      ],
    },
    {
      key: 'house',
      title: 'menu.group.works',
      items: [
        { title: 'menu.staff.report', command: 'report' },
        // Рассылку должникам делают диспетчер и управляющий: мастеру суммы дома
        // в работе не нужны, а писать он по ним всё равно не может.
        { title: 'menu.staff.debts', command: 'debts', roles: ['dispatcher', 'manager'] },
        {
          title: 'menu.vote',
          command: 'vote',
          app: { screen: 'polls', about: 'menu.staff.vote.about' },
        },
        { title: 'menu.door', command: 'door' },
      ],
    },
    {
      // Сотрудник тоже живёт в квартире и сам пишет в управляющую организацию:
      // без этих пунктов ему пришлось бы вспоминать команды.
      key: 'me',
      title: 'menu.group.me',
      items: [
        // Сотрудник платит за свою квартиру так же, как жилец: без этих пунктов
        // помощник называл ему раздел, в который нечем перейти.
        { title: 'menu.bill', command: 'bill' },
        { title: 'menu.meters', command: 'meters' },
        { title: 'menu.mydata', command: 'mydata' },
        { title: 'menu.contacts', command: 'contacts' },
        {
          title: 'menu.notices',
          command: 'notices',
          app: { screen: 'profile', about: 'menu.notices.about' },
        },
      ],
    },
    {
      key: 'app',
      title: 'menu.group.app',
      items: [
        {
          title: 'menu.staff.inspections',
          command: 'inspections',
          app: { screen: 'inspections', about: 'menu.staff.inspections.about' },
        },
        {
          title: 'menu.staff.plan',
          command: 'plan',
          app: { screen: 'plan', about: 'menu.staff.plan.about' },
        },
        {
          title: 'menu.staff.equipment',
          command: 'equipment',
          app: { screen: 'equipment', about: 'menu.staff.equipment.about' },
        },
        {
          title: 'menu.staff.house_meters',
          command: 'house-meters',
          app: { screen: 'house-meters', about: 'menu.staff.house_meters.about' },
        },
        {
          title: 'menu.staff.residents',
          command: 'residents',
          app: { screen: 'residents', about: 'menu.staff.residents.about' },
        },
        { title: 'menu.staff.stickers', command: 'stickers' },
      ],
    },
    {
      key: 'manage',
      title: 'menu.group.manage',
      items: [
        {
          title: 'menu.staff.tariffs',
          command: 'tariffs',
          app: { screen: 'tariffs', about: 'menu.staff.tariffs.about' },
          roles: ['manager'],
        },
        {
          title: 'menu.staff.card',
          command: 'card',
          app: { screen: 'import', about: 'menu.staff.card.about' },
          roles: ['manager'],
        },
        {
          title: 'menu.staff.buildings',
          command: 'buildings',
          app: { screen: 'buildings', about: 'menu.staff.buildings.about' },
          roles: ['manager'],
        },
        {
          title: 'menu.staff.audit',
          command: 'audit',
          app: { screen: 'audit', about: 'menu.staff.audit.about' },
          roles: ['manager'],
        },
      ],
    },
  ],
};

/** Дела управляющей организации: мастеру и подрядчику они не поручены. */
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
const DEMO_ITEM: MenuItem = { title: 'menu.demo', command: 'demo' };

/** Жильцу без квартиры остаётся одно дело: привязать её. */
const BIND_ITEM: MenuItem = { title: 'menu.flat', command: 'flat' };

/** Объявления и контакты дома открыты и без квартиры, когда дом уже известен. */
const NEWS_ITEM: MenuItem = { title: 'menu.news', command: 'news' };
const CONTACTS_ITEM: MenuItem = { title: 'menu.contacts', command: 'contacts' };

/** Язык меняется и до привязки: с ним человек хотя бы прочтёт просьбу о коде. */
const LANG_ITEM: MenuItem = { title: 'menu.lang', command: 'lang' };

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
    // Дом человек мог назвать сканом наклейки на подъезде. Тогда объявления
    // и контакты ему открыты: они принадлежат дому, а не помещению, и меню
    // из одной кнопки было бы враньём.
    const house = knowsHouse(resident) ? [NEWS_ITEM, CONTACTS_ITEM] : [];
    const bind = [BIND_ITEM, ...house, LANG_ITEM];

    return { top: offer.demo === true ? [...bind, DEMO_ITEM] : bind, groups: [] };
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

const rows = (items: readonly MenuItem[], t: Translate): ReturnType<typeof Keyboard.button.callback>[][] => {
  const built: ReturnType<typeof Keyboard.button.callback>[][] = [];

  for (let at = 0; at < items.length; at += 2) {
    built.push(items.slice(at, at + 2).map((item) => Keyboard.button.callback(t(item.title), payloadOf(item))));
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
export const menuKeyboard = (
  resident: Resident,
  miniAppUrl?: string,
  offer: MenuOffer = {},
  t: Translate = RU,
): Extra => {
  const menu = menuFor(resident, offer);

  const groups = menu.groups.map((group) => Keyboard.button.callback(t(group.title), `group:${group.key}`));
  const grouped: ReturnType<typeof Keyboard.button.callback>[][] = [];

  for (let at = 0; at < groups.length; at += 2) grouped.push(groups.slice(at, at + 2));

  const app = miniAppUrl ? [[Keyboard.button.openApp(t('button.open_app'), miniAppUrl)]] : [];

  const built = {
    attachments: [
      Keyboard.inlineKeyboard([
        ...rows(menu.top, t),
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
export const groupKeyboard = (group: MenuGroup, t: Translate = RU): Extra => screenOf({
  attachments: [
    Keyboard.inlineKeyboard([...rows(group.items, t), [Keyboard.button.callback(t('button.menu'), 'group:back')]]),
  ],
});
