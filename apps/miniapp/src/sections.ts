import { type ReactNode } from 'react';

import { type Screen } from './navigation.js';
import type { RoleView } from './views.js';
import {
  IconBuildings,
  IconCalendar,
  IconChat,
  IconHelp,
  IconHome,
  IconKey,
  IconMeters,
  IconMore,
  IconNews,
  IconPeople,
  IconPerson,
  IconPolls,
  IconQueue,
  IconReport,
  IconRequests,
  IconRuble,
  IconSend,
  IconSticker,
  IconWrench,
} from './screens/icons.js';

export interface Section {
  screen: Screen;
  title: string;
  /** Пояснение в списке «Ещё»: в нижней панели для него нет места. */
  hint: string;
  /** Значок для нижней панели: подпись рядом с ним остаётся. */
  icon: () => ReactNode;
  /** Цвет плитки в списке «Ещё». */
  tone: string;
  /** Подпись группы в списке «Ещё»: у смены разделов много. */
  group?: string;
}

/** Разделы жильца. «Новая заявка» это действие, поэтому не вкладка. */
const RESIDENT_SECTIONS: readonly Section[] = [
  { screen: 'list', title: 'Заявки', hint: 'Обращения и приёмка', icon: IconRequests, tone: 'tile-blue' },
  { screen: 'home', title: 'Дом', hint: 'Двери и камеры', icon: IconKey, tone: 'tile-teal' },
  { screen: 'meters', title: 'Оплата', hint: 'Квитанция и показания', icon: IconMeters, tone: 'tile-yellow' },
  { screen: 'news', title: 'Новости', hint: 'Объявления дома', icon: IconNews, tone: 'tile-orange' },
];

const RESIDENT_EXTRA: readonly Section[] = [
  { screen: 'polls', title: 'Собрания', hint: 'Голосования и предложения', icon: IconPolls, tone: 'tile-green' },
  { screen: 'quality', title: 'Работа дома', hint: 'Как справляется компания', icon: IconReport, tone: 'tile-blue' },
  { screen: 'support', title: 'Поддержка', hint: 'Вопрос в управляющую компанию', icon: IconChat, tone: 'tile-teal' },
  { screen: 'visits', title: 'Приём', hint: 'Запись в управляющую компанию', icon: IconCalendar, tone: 'tile-green' },
  { screen: 'help', title: 'Помощник', hint: 'Спросите словами, что нужно', icon: IconHelp, tone: 'tile-yellow' },
  { screen: 'profile', title: 'Профиль', hint: 'Ваши данные', icon: IconPerson, tone: 'tile-grey' },
];

/** Подрядчику дом не показывают: у него только порученные наряды. */
const CONTRACTOR_SECTIONS: readonly Section[] = [
  { screen: 'list', title: 'Наряды', hint: 'Ваши наряды', icon: IconRequests, tone: 'tile-blue' },
  { screen: 'profile', title: 'Профиль', hint: 'Ваши данные', icon: IconPerson, tone: 'tile-grey' },
];

/** Своя квартира есть и у подрядчика: наряды чужого дома с ней не связаны. */
const CONTRACTOR_EXTRA: readonly Section[] = [
  { screen: 'meters', title: 'Оплата', hint: 'Ваша квитанция', icon: IconMeters, tone: 'tile-yellow' },
  { screen: 'support', title: 'Поддержка', hint: 'Вопрос в управляющую компанию', icon: IconChat, tone: 'tile-teal' },
  { screen: 'polls', title: 'Собрания', hint: 'Голосования и предложения', icon: IconPolls, tone: 'tile-green' },
  { screen: 'quality', title: 'Работа дома', hint: 'Как справляются в вашем доме', icon: IconReport, tone: 'tile-blue' },
];

/** Разделы сотрудника: в панели то, чем пользуются в смену, остальное в «Ещё». */
const STAFF_SECTIONS: readonly Section[] = [
  { screen: 'queue', title: 'Очередь', hint: 'Заявки дома', icon: IconQueue, tone: 'tile-red' },
  { screen: 'list', title: 'Работа', hint: 'Ваши наряды', icon: IconRequests, tone: 'tile-blue' },
  { screen: 'home', title: 'Дом', hint: 'Оборудование и журнал', icon: IconKey, tone: 'tile-teal' },
  { screen: 'news', title: 'Новости', hint: 'Лента и публикация', icon: IconNews, tone: 'tile-orange' },
];

/** У мастера свои наряды впереди: очередь дома ведёт диспетчер. */
const TECHNICIAN_SECTIONS: readonly Section[] = [
  { screen: 'list', title: 'Работа', hint: 'Ваши наряды', icon: IconRequests, tone: 'tile-blue' },
  { screen: 'queue', title: 'Очередь', hint: 'Заявки дома', icon: IconQueue, tone: 'tile-red' },
  { screen: 'home', title: 'Дом', hint: 'Оборудование и журнал', icon: IconKey, tone: 'tile-teal' },
  { screen: 'news', title: 'Новости', hint: 'Лента и публикация', icon: IconNews, tone: 'tile-orange' },
];

/** Порядок: сначала работа по дому, потом дела компании, в конце своё. */
const STAFF_EXTRA: readonly Section[] = [
  { screen: 'support', title: 'Поддержка', hint: 'Вопросы жильцов', icon: IconChat, tone: 'tile-teal', group: 'Смена' },
  {
    screen: 'visits',
    title: 'Приём',
    hint: 'Кто записался и на когда',
    icon: IconCalendar,
    tone: 'tile-green',
    group: 'Смена',
  },
  {
    screen: 'broadcast',
    title: 'Рассылка',
    hint: 'Сообщение жильцам в личные',
    icon: IconSend,
    tone: 'tile-orange',
    group: 'Смена',
  },
  { screen: 'report', title: 'Сводка', hint: 'Работа за период', icon: IconReport, tone: 'tile-blue', group: 'Смена' },
  { screen: 'plan', title: 'План дома', hint: 'Обстановка по квартирам', icon: IconHome, tone: 'tile-red', group: 'Смена' },
  {
    screen: 'inspections',
    title: 'Осмотры',
    hint: 'Обходы и ТО по графику',
    icon: IconRequests,
    tone: 'tile-teal',
    group: 'Смена',
  },
  {
    screen: 'equipment',
    title: 'Оборудование',
    hint: 'Отказы и прогноз',
    icon: IconWrench,
    tone: 'tile-grey',
    group: 'Дом',
  },
  {
    screen: 'stickers',
    title: 'Наклейки',
    hint: 'Коды объектов и лист для печати',
    icon: IconSticker,
    tone: 'tile-blue',
    group: 'Дом',
  },
  {
    screen: 'house-meters',
    title: 'Узел учёта',
    hint: 'Общедомовой расход',
    icon: IconMeters,
    tone: 'tile-yellow',
    group: 'Дом',
  },
  {
    screen: 'tariffs',
    title: 'Тарифы',
    hint: 'Из чего считается счёт',
    icon: IconRuble,
    tone: 'tile-yellow',
    group: 'Деньги',
  },
  {
    screen: 'debtors',
    title: 'Долги',
    hint: 'Кто и сколько должен',
    icon: IconRuble,
    tone: 'tile-red',
    group: 'Деньги',
  },
  {
    screen: 'buildings',
    title: 'Дома',
    hint: 'Все адреса компании',
    icon: IconBuildings,
    tone: 'tile-blue',
    group: 'Управление',
  },
  {
    screen: 'residents',
    title: 'Люди дома',
    hint: 'Роли и дежурство',
    icon: IconPeople,
    tone: 'tile-teal',
    group: 'Управление',
  },
  {
    screen: 'import',
    title: 'Завести дом',
    hint: 'Квартиры и оборудование',
    icon: IconBuildings,
    tone: 'tile-teal',
    group: 'Управление',
  },
  {
    screen: 'audit',
    title: 'Действия',
    hint: 'Кто что сделал',
    icon: IconQueue,
    tone: 'tile-grey',
    group: 'Управление',
  },
  {
    screen: 'polls',
    title: 'Собрания',
    hint: 'Голосования и предложения',
    icon: IconPolls,
    tone: 'tile-green',
    group: 'Своё',
  },
  { screen: 'meters', title: 'Оплата', hint: 'Ваша квитанция', icon: IconMeters, tone: 'tile-yellow', group: 'Своё' },
  {
    screen: 'quality',
    title: 'Работа дома',
    hint: 'Как справляются в вашем доме',
    icon: IconReport,
    tone: 'tile-blue',
    group: 'Своё',
  },
  { screen: 'profile', title: 'Профиль', hint: 'Ваши данные', icon: IconPerson, tone: 'tile-grey', group: 'Своё' },
];

/** Разделы про свою квартиру: в шапке над ними стоит переключатель квартиры. */
export const HOME_SCREENS: readonly Screen[] = ['meters', 'polls', 'quality'];

/** Сколько разделов помещается в нижнюю панель. */
const TABS_LIMIT = 5;

/** Разделы только для управляющего и только для привязанной квартиры. */
const FOR_MANAGER: readonly Screen[] = ['audit', 'import'];
/** Рассылку ведёт тот, кто отвечает за дом перед жильцами. */
const FOR_DISPATCHER: readonly Screen[] = ['broadcast'];
const FOR_BOUND: readonly Screen[] = ['meters', 'quality'];

export interface Layout {
  /** Все разделы человека по порядку: из них берутся и панель, и «Ещё». */
  everything: Section[];
  tabs: Section[];
  /** То, что не поместилось в панель. */
  hidden: Section[];
}

/** Что подключено в этой установке: неподключённых разделов в панели нет. */
export interface Offer {
  doors?: boolean;
  /** Управляющая организация ведёт приём по записи. */
  reception?: boolean;
  /** Файлы уходят в переписку с ботом: наклейки и выгрузки. */
  files?: boolean;
  /** Режим проверки: разрешено примерить другую роль. */
  demo?: boolean;
}

/** Какому разделу нужен поставщик, без которого он показывает только отказ. */
const REQUIRES: Readonly<Partial<Record<Screen, keyof Offer>>> = {
  home: 'doors',
  visits: 'reception',
  stickers: 'files',
};

/** Раздел проверки: в обычной установке его нет вовсе. */
const DEMO_SECTION: Section = {
  screen: 'demo',
  title: 'Роль',
  hint: 'Посмотреть продукт другой стороной',
  icon: IconPeople,
  tone: 'tile-green',
  group: 'Проверка',
};

/** Есть ли раздел в этой установке: по ссылке на него тоже не попасть. */
export const offeredScreen = (screen: Screen, offer: Offer = {}): boolean => {
  if (screen === 'demo') return offer.demo === true;

  const needs = REQUIRES[screen];

  return needs === undefined || offer[needs] !== false;
};

/** Какие разделы видит человек и что из них попадает в нижнюю панель. */
export const layoutSections = (role: RoleView, bound: boolean, offer: Offer = {}): Layout => {
  const contractor = role === 'contractor';
  const isStaff = role !== 'resident';
  const needsBinding = !isStaff && !bound;

  const sections = contractor
    ? CONTRACTOR_SECTIONS
    : role === 'technician'
      ? TECHNICIAN_SECTIONS
      : isStaff
        ? STAFF_SECTIONS
        : RESIDENT_SECTIONS;

  const extra = contractor
    ? bound
      ? CONTRACTOR_EXTRA
      : []
    : (isStaff ? STAFF_EXTRA : RESIDENT_EXTRA).filter(
        (section) =>
          (!FOR_MANAGER.includes(section.screen) || role === 'manager') &&
          (!FOR_DISPATCHER.includes(section.screen) || role === 'manager' || role === 'dispatcher') &&
          (!FOR_BOUND.includes(section.screen) || bound),
      );

  const flat: Section = {
    screen: 'bind',
    title: needsBinding ? 'Квартира' : bound ? 'Добавить квартиру' : 'Моя квартира',
    hint: 'По коду из квитанции',
    icon: IconHome,
    tone: 'tile-blue',
  };

  const ordered = needsBinding ? [flat, ...sections, ...extra] : [...sections, ...extra, flat];
  const everything = [...ordered, DEMO_SECTION].filter((section) => offeredScreen(section.screen, offer));
  const fits = everything.length <= TABS_LIMIT;
  const inBar = fits ? everything : everything.slice(0, TABS_LIMIT - 1);

  return {
    everything,
    hidden: everything.slice(inBar.length),
    tabs: fits
      ? inBar
      : [...inBar, { screen: 'more', title: 'Ещё', hint: 'Остальные разделы', icon: IconMore, tone: 'tile-grey' }],
  };
};
