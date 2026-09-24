import { type ReactNode } from 'react';

import type { Translate } from '@domovoy/i18n';

import { say } from './i18n.js';
import { type Screen } from './navigation.js';
import type { RoleView } from './views.js';
import {
  IconBuildings,
  IconCalendar,
  IconChat,
  IconGlobe,
  IconHelp,
  IconHome,
  IconKey,
  IconMeters,
  IconMore,
  IconNews,
  IconPayment,
  IconPeople,
  IconPerson,
  IconPolls,
  IconQueue,
  IconRepair,
  IconReport,
  IconRequests,
  IconRuble,
  IconSend,
  IconSticker,
  IconWrench,
  type IconProps,
} from './screens/icons.js';

export interface Section {
  screen: Screen;
  title: string;
  /** Пояснение в списке «Ещё»: в нижней панели для него нет места. */
  hint: string;
  /** Значок для нижней панели: подпись рядом с ним остаётся. */
  icon: (props?: IconProps) => ReactNode;
  /** Цвет плитки в списке «Ещё». */
  tone: string;
  /** Подпись группы в списке «Ещё»: у смены разделов много. */
  group?: string;
}

/** Разделы жильца. «Новая заявка» это действие, поэтому не вкладка. */
const residentSections = (t: Translate): readonly Section[] => [
  { screen: 'list', title: t('sections.list.title'), hint: t('sections.list.hint'), icon: IconRequests, tone: 'tile-blue' },
  { screen: 'home', title: t('sections.home.title'), hint: t('sections.home.hint'), icon: IconKey, tone: 'tile-teal' },
  {
    screen: 'meters',
    title: t('sections.meters.title'),
    hint: t('sections.meters.hint'),
    icon: IconPayment,
    tone: 'tile-yellow',
  },
  { screen: 'news', title: t('sections.news.title'), hint: t('sections.news.hint'), icon: IconNews, tone: 'tile-orange' },
];

/** Профиль: он есть и у жильца без квартиры, там документы и свои данные. */
const profileSection = (t: Translate): Section => ({
  screen: 'profile',
  title: t('sections.profile.title'),
  hint: t('sections.profile.hint'),
  icon: IconPerson,
  tone: 'tile-grey',
});

/** Язык: он нужен и до квартиры, иначе остальные разделы не прочитать. */
const languageSection = (t: Translate): Section => ({
  screen: 'language',
  title: t('sections.language.title'),
  hint: t('sections.language.hint'),
  icon: IconGlobe,
  tone: 'tile-blue',
});

const residentExtra = (t: Translate): readonly Section[] => [
  { screen: 'polls', title: t('sections.polls.title'), hint: t('sections.polls.hint'), icon: IconPolls, tone: 'tile-green' },
  {
    screen: 'quality',
    title: t('sections.quality.title'),
    hint: t('sections.quality.hint'),
    icon: IconReport,
    tone: 'tile-blue',
  },
  {
    screen: 'support',
    title: t('sections.support.title'),
    hint: t('sections.support.hint'),
    icon: IconChat,
    tone: 'tile-teal',
  },
  {
    screen: 'visits',
    title: t('sections.visits.title'),
    hint: t('sections.visits.hint'),
    icon: IconCalendar,
    tone: 'tile-green',
  },
  {
    screen: 'capital',
    title: t('sections.capital.title'),
    hint: t('sections.capital.hint'),
    icon: IconRepair,
    tone: 'tile-orange',
  },
  { screen: 'help', title: t('sections.help.title'), hint: t('sections.help.hint'), icon: IconHelp, tone: 'tile-yellow' },
  profileSection(t),
  languageSection(t),
];

/** Подрядчику дом не показывают: у него только порученные наряды. */
const contractorSections = (t: Translate): readonly Section[] => [
  { screen: 'list', title: 'Наряды', hint: 'Ваши наряды', icon: IconRequests, tone: 'tile-blue' },
  profileSection(t),
];

/** Своя квартира есть и у подрядчика: наряды чужого дома с ней не связаны. */
const contractorExtra = (t: Translate): readonly Section[] => [
  {
    screen: 'meters',
    title: t('sections.meters.title'),
    hint: t('sections.meters.hint.own'),
    icon: IconPayment,
    tone: 'tile-yellow',
  },
  {
    screen: 'support',
    title: t('sections.support.title'),
    hint: t('sections.support.hint'),
    icon: IconChat,
    tone: 'tile-teal',
  },
  { screen: 'polls', title: t('sections.polls.title'), hint: t('sections.polls.hint'), icon: IconPolls, tone: 'tile-green' },
  {
    screen: 'quality',
    title: t('sections.quality.title'),
    hint: t('sections.quality.hint.house'),
    icon: IconReport,
    tone: 'tile-blue',
  },
];

/** Разделы сотрудника: в панели то, чем пользуются в смену, остальное в «Ещё». */
const STAFF_SECTIONS: readonly Section[] = [
  { screen: 'queue', title: 'Очередь', hint: 'Заявки дома', icon: IconQueue, tone: 'tile-red' },
  { screen: 'list', title: 'Наряды', hint: 'Ваши наряды', icon: IconRequests, tone: 'tile-blue' },
  { screen: 'home', title: 'Дом', hint: 'Оборудование и журнал', icon: IconKey, tone: 'tile-teal' },
  { screen: 'news', title: 'Новости', hint: 'Лента и публикация', icon: IconNews, tone: 'tile-orange' },
];

/** У мастера свои наряды впереди: очередь дома ведёт диспетчер. */
const TECHNICIAN_SECTIONS: readonly Section[] = [
  { screen: 'list', title: 'Наряды', hint: 'Ваши наряды', icon: IconRequests, tone: 'tile-blue' },
  // День обхода нужен мастеру каждую смену, но начинает он со списка нарядов:
  // на день могут быть назначены не все. Диспетчеру и управляющему он пуст.
  { screen: 'workday', title: 'Мой день', hint: 'Наряды по порядку обхода', icon: IconCalendar, tone: 'tile-green' },
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
    title: 'Карточка дома',
    hint: 'Контакты, квартиры и оборудование',
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
  {
    screen: 'capital',
    title: 'Капремонт',
    hint: 'Программа по дому',
    icon: IconRepair,
    tone: 'tile-orange',
    group: 'Дом',
  },
  { screen: 'meters', title: 'Оплата', hint: 'Ваша квитанция', icon: IconPayment, tone: 'tile-yellow', group: 'Своё' },
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

/** Язык сотрудник меняет там же, где и остальное своё. */
const staffExtra = (t: Translate): readonly Section[] => [...STAFF_EXTRA, { ...languageSection(t), group: 'Своё' }];

/** Разделы про свою квартиру: в шапке над ними стоит переключатель квартиры. */
export const HOME_SCREENS: readonly Screen[] = ['meters', 'polls', 'quality'];

/** Сколько разделов помещается в нижнюю панель. */
const TABS_LIMIT = 5;

/** Разделы только для управляющего и только для привязанной квартиры. */
const FOR_MANAGER: readonly Screen[] = ['audit', 'import'];
/** Рассылку ведёт тот, кто отвечает за дом перед жильцами. */
const FOR_DISPATCHER: readonly Screen[] = ['broadcast'];
const FOR_BOUND: readonly Screen[] = ['meters', 'quality'];

/**
 * Разделы про свою квартиру. В рабочем меню смены их нет: сотрудник пришёл
 * работать по дому, а не платить за себя. В режиме показа они остаются, иначе
 * проверяющему негде посмотреть жильцовую часть.
 */
const RESIDENT_OWN: readonly Screen[] = ['meters', 'quality', 'polls', 'bind'];

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
const demoSection = (t: Translate): Section => ({
  screen: 'demo',
  title: t('sections.demo.title'),
  hint: t('sections.demo.hint'),
  icon: IconPeople,
  tone: 'tile-green',
  group: t('sections.demo.group'),
});

/** Есть ли раздел в этой установке: по ссылке на него тоже не попасть. */
export const offeredScreen = (screen: Screen, offer: Offer = {}): boolean => {
  if (screen === 'demo') return offer.demo === true;

  const needs = REQUIRES[screen];

  return needs === undefined || offer[needs] !== false;
};

/** Какие разделы видит человек и что из них попадает в нижнюю панель. */
export const layoutSections = (role: RoleView, bound: boolean, offer: Offer = {}, t: Translate = say): Layout => {
  const contractor = role === 'contractor';
  const isStaff = role !== 'resident';
  const needsBinding = !isStaff && !bound;
  const demo = demoSection(t);

  const flat: Section = {
    screen: 'bind',
    title:
      needsBinding || contractor
        ? t('sections.bind.title')
        : bound
          ? t('sections.bind.title.add')
          : t('sections.bind.title.own'),
    hint: t('sections.bind.hint'),
    icon: IconHome,
    tone: 'tile-blue',
  };

  // Жильцу без квартиры дома нет: только привязка, профиль, язык и, на проверке,
  // примерка роли. Панели разделов у него нет, к профилю ведёт сам экран.
  if (needsBinding) {
    return {
      everything: [flat, profileSection(t), languageSection(t), ...(offer.demo === true ? [demo] : [])],
      tabs: [],
      hidden: [],
    };
  }

  const sections = contractor
    ? contractorSections(t)
    : role === 'technician'
      ? TECHNICIAN_SECTIONS
      : isStaff
        ? STAFF_SECTIONS
        : residentSections(t);

  const extra = contractor
    ? bound
      ? contractorExtra(t)
      : []
    : (isStaff ? staffExtra(t) : residentExtra(t)).filter(
        (section) =>
          (!FOR_MANAGER.includes(section.screen) || role === 'manager') &&
          (!FOR_DISPATCHER.includes(section.screen) || role === 'manager' || role === 'dispatcher') &&
          (!FOR_BOUND.includes(section.screen) || bound),
      );

  const everything = [...sections, ...extra, flat, demo].filter(
    (section) =>
      offeredScreen(section.screen, offer) &&
      (!isStaff || contractor || offer.demo === true || !RESIDENT_OWN.includes(section.screen)),
  );
  const fits = everything.length <= TABS_LIMIT;
  const inBar = fits ? everything : everything.slice(0, TABS_LIMIT - 1);

  return {
    everything,
    hidden: everything.slice(inBar.length),
    tabs: fits
      ? inBar
      : [
          ...inBar,
          {
            screen: 'more',
            title: t('sections.more.title'),
            hint: t('sections.more.hint'),
            icon: IconMore,
            tone: 'tile-grey',
          },
        ],
  };
};
