import { Button, MaxUI, useSystemColorScheme } from '@maxhub/max-ui';
import { useBackButton, useBridgeRequest, useLaunchParams } from '@maxkit/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Language } from '@domovoy/i18n';

import {
  DomovoyApi,
  browserCache,
  type DeviceView,
  type DocumentStructure,
  type Profile,
  type RoleView,
} from './api.js';
import { useHaptics } from './haptics.js';
import {
  isSectionParam,
  screenFromStartParam,
  startParamFromUrl,
  startScreen,
  titleFor,
  useScreens,
  type Screen,
  type Screens,
} from './navigation.js';
import { CapabilitiesProvider } from './capabilities.js';
import { I18nProvider, useT } from './i18n.js';
import { HOME_SCREENS, layoutSections, offeredScreen, type Offer, type Section } from './sections.js';
import { Toasts } from './toast.js';
import { Viewer } from './viewer.js';
import { useApartment } from './use-apartment.js';
import { useSession } from './session.js';
import { Empty } from './screens/Empty.js';
import { Assistant } from './screens/Assistant.js';
import { Consent } from './screens/Consent.js';
import { LanguageSheet } from './screens/LanguageScreen.js';
import { useTour } from './use-tour.js';
import { Tour, type TourStep } from './screens/Tour.js';
import { IconHome } from './screens/icons.js';
import { Loading } from './screens/Loading.js';
import { ScreenGuard } from './screens/ScreenGuard.js';
import { TabBar } from './screens/TabBar.js';
import { TopBar, type TopBarProps } from './screens/TopBar.js';
import { screenBody, type ScreenContext } from './screens/registry.js';

export interface AppProps {
  /** Адрес прикладного API. */
  baseUrl: string;
  /** Чем ходить на сервер: в тестах подменяется, чтобы не трогать сеть. */
  fetch?: typeof globalThis.fetch;
}

/** Обёртка кита: внутри неё живут переменные оформления MAX и итоги действий. */
const Shell = ({ children }: { children: ReactNode }) => (
  <MaxUI className="app" colorScheme={useSystemColorScheme()}>
    <Viewer>
      <Toasts>{children}</Toasts>
    </Viewer>
  </MaxUI>
);

/** Сколько дел ждёт человека в каждом разделе: из этого рисуются значки. */
export type Waiting = Partial<Record<Screen, number>>;

/** Документ, открытый своим экраном. */
export type OpenedDocument = DocumentStructure & { title: string; text: string };

/** Что ждёт действия именно от этого человека и в каких разделах. */
const useWaiting = (api: DomovoyApi, role: RoleView, version: number, enabled: boolean): Waiting => {
  const queue = role === 'dispatcher' || role === 'manager';

  // Жильцу без квартиры разделы закрыты: считать ему нечего.
  const list = useBridgeRequest(
    (alive) => (enabled ? api.until(alive).listRequests(queue ? 'queue' : 'mine') : Promise.resolve([])),
    [api, queue, version, enabled],
  );

  /** Смене, вопросы без ответа, жильцу, ответы, которые он ещё не читал. */
  const support = useBridgeRequest(
    (alive) => (enabled ? api.until(alive).supportWaiting().catch(() => ({ waiting: 0 })) : Promise.resolve({ waiting: 0 })),
    [api, version, enabled],
  );

  const count = (list.data ?? []).filter((request) => {
    if (queue) return request.overdue || request.status === 'new';
    if (role === 'technician') return request.overdue;

    return request.status === 'needs_info' || request.status === 'done';
  }).length;

  return { [queue ? 'queue' : 'list']: count, support: support.data?.waiting ?? 0 };
};

/** Уехала ли страница из-под шапки: от этого зависит разделитель под ней. */
const useScrolled = (): boolean => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // Прокрутка идёт по окну, но событие слушают на перехвате: так же считается
    // и прокрутка рабочей области, если она когда-нибудь станет своим слоем.
    const onScroll = (event: Event): void => {
      const node = event.target;

      if (node instanceof HTMLElement && node.tagName !== 'MAIN') return;

      setScrolled((node instanceof HTMLElement ? node.scrollTop : globalThis.scrollY) > 4);
    };

    onScroll(new Event('scroll'));
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });

    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  return scrolled;
};

interface WorkspaceProps {
  api: DomovoyApi;
  profile: Profile;
  /** Перечитать сессию: изменились квартира, роль или согласия. */
  refreshSession: () => void;
  /** Поправить профиль на месте, не входя заново. */
  patchProfile: (update: (profile: Profile) => Profile) => void;
  /** Код объекта из параметров запуска, если приложение открыли по наклейке. */
  launched: string | undefined;
  offline: boolean;
}

/** Куда ведёт ссылка запуска: раздела без поставщика в этой установке нет. */
const linkedScreen = (param: string | undefined, offer: Offer): Screen | undefined => {
  const asked = screenFromStartParam(param);

  return asked && offeredScreen(asked, offer) ? asked : undefined;
};

/**
 * С чего начать по ссылке запуска: раздел или код объекта. Ссылка на раздел
 * кодом объекта не является: паспорт по ней не открывают, а незнакомый раздел
 * просто открывает приложение с начала. Жильцу без квартиры дома нет, и ссылка
 * ждёт привязки.
 */
const entryOf = (
  profile: Profile,
  param: string | undefined,
  offer: Offer,
): { needsBinding: boolean; screen: Screen | undefined; object: string | undefined } => {
  const needsBinding = profile.role === 'resident' && profile.apartmentId === null;

  if (needsBinding) return { needsBinding, screen: undefined, object: undefined };

  return { needsBinding, screen: linkedScreen(param, offer), object: isSectionParam(param) ? undefined : param };
};

/** Переключатели шапки: дом у смены вне квартирных разделов, квартира у жильца в корне. */
const switchesOf = (input: {
  isStaff: boolean;
  needsBinding: boolean;
  deep: boolean;
  homeScreen: boolean;
  building: { id: string | null; version: number };
  setBuilding: (update: (current: { id: string | null; version: number }) => { id: string | null; version: number }) => void;
  apartment: string | null;
  pick: (apartmentId: string) => void;
}): { building?: TopBarProps['building']; apartment?: TopBarProps['apartment'] } => {
  const picksBuilding = input.isStaff && !input.deep && !input.homeScreen;
  const picksApartment = !input.needsBinding && (input.homeScreen || (!input.isStaff && !input.deep));

  return {
    ...(picksBuilding
      ? {
          building: {
            value: input.building.id,
            onChange: (id: string | null) => input.setBuilding((current) => ({ id, version: current.version + 1 })),
          },
        }
      : {}),
    ...(picksApartment ? { apartment: { value: input.apartment, onChange: input.pick } } : {}),
  };
};

/** Что подключено в этой установке: раздела без поставщика человек не видит. */
const offerOf = (profile: Profile): Offer => ({
  doors: profile.doors !== false,
  reception: profile.reception === true,
  files: profile.files !== false,
  demo: profile.demo === true,
});

/** Согласие с документами: до него продукт ничего о человеке не сохраняет. */
const accepted = (profile: Profile): boolean => profile.legal?.accepted !== false;

/** Язык спрашивают только у жильца: смена работает по-русски. */
const asksLanguage = (profile: Profile): boolean =>
  profile.role === 'resident' && (profile.language ?? null) === null;

/** Свой язык есть только у жильца: очередь, наряды и сводка ведутся по-русски. */
const speaksOwnLanguage = (profile: Profile): boolean =>
  profile.role === 'resident' && Boolean(profile.language);

/**
 * Первый заход: сначала язык, потом документы, потом короткий тур по разделам.
 * Язык идёт первым: документы человек читает уже на своём. Пока согласия нет,
 * тур не показывается: объяснять продукт до согласия рано.
 */
const FirstRun = ({
  api,
  agreed,
  asksLanguage,
  reading,
  tour,
  onDocument,
  onLanguage,
  onAgreed,
  onTourDone,
}: {
  api: DomovoyApi;
  agreed: boolean;
  /** Язык ещё не выбран, и спросить о нём есть у кого: сотрудник работает по-русски. */
  asksLanguage: boolean;
  /** Открыт документ: окно согласия уходит, чтобы текст было видно, и возвращается по «Назад». */
  reading: boolean;
  tour: TourStep[];
  onDocument: (title: string, text: string) => void;
  onLanguage: (language: Language) => void;
  onAgreed: () => void;
  onTourDone: () => void;
}) => {
  if (!agreed) {
    if (reading) return null;

    return asksLanguage ? (
      <LanguageSheet api={api} onPicked={onLanguage} />
    ) : (
      <Consent api={api} onDocument={onDocument} onAccepted={onAgreed} />
    );
  }

  return tour.length > 0 ? <Tour steps={tour} onDone={onTourDone} /> : null;
};

/** Накладки поверх рабочей области: первый заход и разговор с помощником. */
const Sheets = ({
  tip,
  onCloseTip,
  onGo,
  at,
  ...first
}: Parameters<typeof FirstRun>[0] & {
  tip: boolean;
  onCloseTip: () => void;
  onGo: (screen: string) => void;
  /** Экран, с которого позвали помощника. */
  at?: string;
}) => (
  <>
    {tip ? (
      <Assistant
        api={first.api}
        onLanguage={first.onLanguage}
        onClose={onCloseTip}
        onGo={onGo}
        {...(at ? { at } : {})}
      />
    ) : null}

    <FirstRun {...first} />
  </>
);

/**
 * Стопка при запуске и жизнь отсканированного объекта. Ссылка на стартовый
 * экран не кладёт его в стопку дважды: иначе над ним висит возврат на самого
 * себя. Объект живёт, пока его паспорт в стопке: ушли с него, и код с названием забыты.
 */
const useEntry = (
  screens: Screens,
  launched: { screen: Screen | undefined; param: string | undefined; home: Screen },
  forget: { scanned: (code: null) => void; title: (title: null) => void },
): void => {
  const { seed, stack } = screens;
  const { screen, param, home } = launched;
  const { scanned, title } = forget;

  useEffect(() => {
    if (screen) seed(screen === home ? [home] : [home, screen]);
    else if (param) seed([home, 'object']);
  }, [screen, param, home, seed]);

  useEffect(() => {
    if (stack.includes('object')) return;

    scanned(null);
    title(null);
  }, [stack, scanned, title]);
};

/** «Назад» закрывает сначала помощника, а уже потом уходит с экрана. */
const useBack = (helper: boolean, closeHelper: () => void, screens: Screens): void => {
  useBackButton({
    visible: helper || screens.deep,
    onClick: () => (helper ? closeHelper() : screens.back()),
  });
};

/** Что экраны получают от рабочей области: данные и переходы, собранные в одном месте. */
const screenContext = (input: {
  api: DomovoyApi;
  profile: Profile;
  startParam: string | undefined;
  opened: string | null;
  device: DeviceView | null;
  document: { title: string; text: string } | null;
  hidden: Section[];
  waiting: Waiting;
  changed: number;
  backTitle: string;
  screens: Screens;
  goDeeper: (next: Screen) => void;
  openRequest: (id: string) => void;
  openDocument: (title: string, text: string, structure?: DocumentStructure) => void;
  refreshSession: () => void;
  patchProfile: (update: (profile: Profile) => Profile) => void;
  setScanned: (code: string) => void;
  setDevice: (device: DeviceView) => void;
  setObjectTitle: (title: string | null) => void;
  setChanged: (update: (version: number) => number) => void;
  setBuilding: (update: (current: { id: string | null; version: number }) => { id: string | null; version: number }) => void;
}): ScreenContext => ({
  api: input.api,
  profile: input.profile,
  startParam: input.startParam,
  // Объект попадает в новую заявку только с его паспорта: иначе код с давней наклейки прилипал бы ко всем заявкам.
  reportedObject: input.screens.stack.includes('object') ? input.startParam : undefined,
  opened: input.opened,
  device: input.device,
  document: input.document,
  hidden: input.hidden,
  waiting: input.waiting,
  changed: input.changed,
  backTitle: input.backTitle,
  deep: input.screens.deep,
  open: input.screens.open,
  goDeeper: input.goDeeper,
  back: input.screens.back,
  openRequest: input.openRequest,
  openDocument: input.openDocument,
  openScanned: (code) => {
    input.setScanned(code);
    input.goDeeper('object');
  },
  openDevice: (picked, next) => {
    input.setDevice(picked);
    input.goDeeper(next);
  },
  onObjectTitle: input.setObjectTitle,
  onRequestChanged: () => input.setChanged((version) => version + 1),
  refreshSession: input.refreshSession,
  patchProfile: input.patchProfile,
  openBuilding: (id, next) => {
    input.setBuilding((current) => ({ id, version: current.version + 1 }));
    input.screens.open(next);
  },
});

/** Название экрана: у объекта, устройства и документа оно своё. */
const screenTitle = (
  screen: Screen,
  named: {
    objectTitle: string | null;
    device: DeviceView | null;
    document: { title: string; text: string } | null;
    sections: readonly Section[];
  },
): string =>
  titleFor(screen, {
    object: named.objectTitle,
    device: named.device?.title ?? null,
    document: named.document?.title ?? null,
    section: named.sections.find((section) => section.screen === screen)?.title,
  });

/** Шапка собирается отдельно: переключатели в ней необязательные. */
const topBar = (
  input: Omit<TopBarProps, 'building' | 'apartment' | 'onAssistant'> & {
    building?: TopBarProps['building'];
    apartment?: TopBarProps['apartment'];
    onAssistant?: TopBarProps['onAssistant'];
  },
): TopBarProps => ({
  api: input.api,
  title: input.title,
  scrolled: input.scrolled,
  offline: input.offline,
  onRefresh: input.onRefresh,
  ...(input.building ? { building: input.building } : {}),
  ...(input.apartment ? { apartment: input.apartment } : {}),
  ...(input.onAssistant ? { onAssistant: input.onAssistant } : {}),
});

/** Экраны, которые рисуют возврат сами: у них он стоит рядом со своей навигацией. */
const OWN_BACK: readonly Screen[] = ['request', 'document', 'support'];

/** Рабочая область: разделы, шапка и переходы между экранами. */
const Workspace = ({ api: session, profile, refreshSession, patchProfile, launched, offline }: WorkspaceProps) => {
  const haptics = useHaptics();
  const screens = useScreens();
  const [opened, setOpened] = useState<string | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);
  const [tip, setTip] = useState(false);
  const [agreed, setAgreed] = useState(accepted(profile));
  const [objectTitle, setObjectTitle] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(0);
  const [device, setDevice] = useState<DeviceView | null>(null);
  const [document, setDocument] = useState<OpenedDocument | null>(null);
  const [changed, setChanged] = useState(0);

  const [building, setBuilding] = useState<{ id: string | null; version: number }>({ id: null, version: 0 });
  const { apartment, pick } = useApartment(session, () =>
    setBuilding((current) => ({ ...current, version: current.version + 1 })),
  );

  session.useBuilding(building.id);

  /**
   * Смена дома, квартиры и нажатие «Обновить» дают экранам новую ссылку на
   * клиент: экраны держат её в зависимостях запроса и перечитывают данные,
   * не теряя набранного и не проигрывая въезд заново.
   */
  const api = useMemo(() => session.reread(), [session, building.version, refreshed]);

  const t = useT();
  const offer = offerOf(profile);
  const bound = profile.apartmentId !== null;
  const isStaff = profile.role !== 'resident';
  const { needsBinding, screen: launchedScreen, object: startParam } = entryOf(profile, scanned ?? launched, offer);
  const scrolled = useScrolled();
  const waiting = useWaiting(api, profile.role, changed, !needsBinding);
  const home = startScreen(profile);

  // Раскладка разделов держится за одну ссылку: на неё смотрит подсветка тура.
  const layout = useMemo(
    () => layoutSections(profile.role, bound, offer, t),
    // Состав установки за время сессии не меняется, поэтому в ключе только его признаки и язык.
    [profile.role, bound, offer.doors, offer.reception, offer.files, offer.demo, t],
  );

  // Тур ждёт квартиру: без неё вкладки пустые, а первый шаг повторял бы заголовок экрана.
  const { tour, endTour, startTour } = useTour(layout.tabs, offer.demo, isStaff || bound);

  useEntry(screens, { screen: launchedScreen, param: startParam, home }, { scanned: setScanned, title: setObjectTitle });
  useBack(tip, () => setTip(false), screens);

  /** Переход на вкладку: стопка начинается заново, «назад» из корня некуда. */
  const openTab = (screen: Screen): void => {
    if (screen === 'help') {
      setTip(true);
      return;
    }

    haptics.picked();
    // Значки на вкладках считаются заново: ответ поддержки могли прочитать, заявку принять.
    setChanged((version) => version + 1);
    screens.open(screen);
  };

  const screen = screens.top ?? home;

  /** Переход вглубь: «назад» вернёт туда, откуда пришли. Подсказка открывается поверх. */
  const goDeeper = (next: Screen): void => {
    if (next === 'help') {
      setTip(true);
      return;
    }

    haptics.picked();
    screens.push(next, screen);
  };

  const openRequest = (id: string): void => {
    setOpened(id);
    goDeeper('request');
  };

  /** Длинный текст уходит на свой экран, откуда его копируют. */
  const openDocument = (title: string, text: string, structure?: DocumentStructure): void => {
    setDocument({ title, text, ...structure });
    goDeeper('document');
  };

  const homeScreen = HOME_SCREENS.includes(screen);
  const { everything, tabs, hidden } = layout;

  const title = screenTitle(screen, { objectTitle, device, document, sections: everything });
  const backTitle = screens.under
    ? screenTitle(screens.under, { objectTitle, device, document, sections: everything }) || t('app.back')
    : t('app.back');

  const context = screenContext({
    api,
    profile,
    startParam,
    opened,
    device,
    document,
    hidden,
    waiting,
    changed,
    backTitle,
    screens,
    goDeeper,
    openRequest,
    openDocument,
    refreshSession,
    patchProfile,
    setScanned,
    setDevice,
    setObjectTitle,
    setChanged,
    setBuilding,
  });

  const head = topBar({
    api,
    title,
    scrolled,
    offline,
    ...switchesOf({ isStaff, needsBinding, deep: screens.deep, homeScreen, building, setBuilding, apartment, pick }),
    onRefresh: () => {
      haptics.picked();
      setRefreshed((version) => version + 1);
    },
    // Помощник появляется в шапке после согласия и привязки: до них ему нечего открывать.
    onAssistant: agreed && !needsBinding
      ? () => {
          haptics.picked();
          setTip(true);
        }
      : undefined,
  });

  return (
    <Shell>
      <main>
        <TopBar {...head} />

        {/* Возврат виден на самой странице: системная кнопка клиента есть не
            везде, и человек, который зашёл вглубь, оттуда не выбирается. */}
        {screens.deep && !OWN_BACK.includes(screen) ? (
          <button type="button" className="link back-link" onClick={context.back}>
            <span aria-hidden="true">‹</span> {backTitle}
          </button>
        ) : null}

        <ScreenGuard
          key={screen}
          onHome={() => openTab(home)}
          {...(screens.deep ? { onBack: context.back } : {})}
        >
          {screenBody(screen, context)}
        </ScreenGuard>
      </main>

      {tabs.length > 0 ? (
        <TabBar sections={tabs} current={screen} waiting={waiting} hidden={hidden} onPick={openTab} />
      ) : null}

      <Sheets
        api={api}
        tip={tip}
        agreed={agreed}
        asksLanguage={asksLanguage(profile)}
        reading={screen === 'document'}
        tour={tour}
        onDocument={openDocument}
        onLanguage={(language) => patchProfile((current) => ({ ...current, language }))}
        onAgreed={() => setAgreed(true)}
        onTourDone={endTour}
        onCloseTip={() => setTip(false)}
        // Экран, с которого позвали помощника: он помогает с делом здесь,
        // а не отправляет в раздел, в котором человек уже стоит.
        at={screen}
        // Тур не раздел: помощник его запускает, а не открывает.
        onGo={(target) =>
          target === 'tour' ? startTour() : target === 'new' ? goDeeper('new') : openTab(target as Screen)
        }
      />
    </Shell>
  );
};

/** Вход идёт молча: человек видит, что приложение не замерло. */
const Entering = () => {
  const t = useT();

  return (
    <main>
      <Loading>{t('app.entering')}</Loading>
    </main>
  );
};

/** Войти не вышло: причина и повтор. */
const EnterFailed = ({ message, onRetry }: { message: string; onRetry: () => void }) => {
  const t = useT();

  return (
    <main>
      <Empty icon={<IconHome />} title={t('app.enter.failed')} hint={message}>
        <Button type="button" onClick={onRetry}>
          {t('app.retry')}
        </Button>
      </Empty>
    </main>
  );
};

/** Корень мини-приложения: сначала вход, потом разделы. */
export const App = ({ baseUrl, fetch }: AppProps) => {
  const launch = useLaunchParams();
  const [offline, setOffline] = useState(false);
  const api = useMemo(
    () =>
      new DomovoyApi({
        baseUrl,
        cache: browserCache(),
        onOffline: setOffline,
        ...(fetch ? { fetch } : {}),
      }),
    [baseUrl, fetch],
  );

  const session = useSession(api, launch.initData);
  // Ссылка запуска ведёт один раз: после смены роли или привязки квартиры человек
  // начинает со стартового экрана новой роли, а не снова с раздела из ссылки.
  const [relaunch, setRelaunch] = useState(true);
  const refresh = useCallback(() => {
    setRelaunch(false);
    if (session.status === 'ready') session.refresh();
  }, [session]);

  if (session.status === 'loading') {
    return (
      <I18nProvider>
        <Shell>
          <Entering />
        </Shell>
      </I18nProvider>
    );
  }

  if (session.status === 'error') {
    return (
      <I18nProvider>
        <Shell>
          <EnterFailed message={session.message} onRetry={session.retry} />
        </Shell>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider {...(speaksOwnLanguage(session.profile) ? { language: session.profile.language } : {})}>
      <CapabilitiesProvider voice={session.profile.voice}>
        <Workspace
          api={api}
          profile={session.profile}
          refreshSession={refresh}
          patchProfile={session.patch}
          launched={relaunch ? (launch.initDataUnsafe.start_param ?? startParamFromUrl()) : undefined}
          offline={offline}
        />
      </CapabilitiesProvider>
    </I18nProvider>
  );
};
