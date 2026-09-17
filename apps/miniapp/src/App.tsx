import { Button, MaxUI, useSystemColorScheme } from '@maxhub/max-ui';
import { useBackButton, useBridgeRequest, useLaunchParams } from '@maxkit/react';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DomovoyApi, browserCache, type DeviceView, type Profile, type RoleView } from './api.js';
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
import { HOME_SCREENS, layoutSections, offeredScreen, type Offer, type Section } from './sections.js';
import { Toasts } from './toast.js';
import { Viewer } from './viewer.js';
import { useApartment } from './use-apartment.js';
import { useSession } from './session.js';
import { Empty } from './screens/Empty.js';
import { Assistant } from './screens/Assistant.js';
import { Consent } from './screens/Consent.js';
import { useTour } from './use-tour.js';
import { Tour, type TourStep } from './screens/Tour.js';
import { IconHome } from './screens/icons.js';
import { Loading } from './screens/Loading.js';
import { TabBar } from './screens/TabBar.js';
import { TopBar } from './screens/TopBar.js';
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

/** Что ждёт действия именно от этого человека и в каких разделах. */
const useWaiting = (api: DomovoyApi, role: RoleView, version: number): Waiting => {
  const queue = role === 'dispatcher' || role === 'manager';

  const list = useBridgeRequest(() => api.listRequests(queue ? 'queue' : 'mine'), [api, queue, version]);

  /** Смене, вопросы без ответа, жильцу, ответы, которые он ещё не читал. */
  const support = useBridgeRequest(
    () => api.supportWaiting().catch(() => ({ waiting: 0 })),
    [api, version],
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
    const onScroll = (): void => setScrolled(globalThis.scrollY > 4);

    onScroll();
    globalThis.addEventListener('scroll', onScroll, { passive: true });

    return () => globalThis.removeEventListener('scroll', onScroll);
  }, []);

  return scrolled;
};

interface WorkspaceProps {
  api: DomovoyApi;
  profile: Profile;
  /** Перечитать сессию: изменились квартира, роль или согласия. */
  refreshSession: () => void;
  /** Код объекта из параметров запуска, если приложение открыли по наклейке. */
  launched: string | undefined;
  offline: boolean;
}

/** Куда ведёт ссылка запуска: раздела без поставщика в этой установке нет. */
const linkedScreen = (param: string | undefined, offer: Offer): Screen | undefined => {
  const asked = screenFromStartParam(param);

  return asked && offeredScreen(asked, offer) ? asked : undefined;
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

/**
 * Первый заход: сначала документы, потом короткий тур по разделам. Пока
 * согласия нет, тур не показывается: объяснять продукт до согласия рано.
 */
const FirstRun = ({
  api,
  agreed,
  tour,
  onDocument,
  onAgreed,
  onTourDone,
}: {
  api: DomovoyApi;
  agreed: boolean;
  tour: TourStep[];
  onDocument: (title: string, text: string) => void;
  onAgreed: () => void;
  onTourDone: () => void;
}) => {
  if (!agreed) return <Consent api={api} onDocument={onDocument} onAccepted={onAgreed} />;

  return tour.length > 0 ? <Tour steps={tour} onDone={onTourDone} /> : null;
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
  screens: Screens;
  goDeeper: (next: Screen) => void;
  openRequest: (id: string) => void;
  openDocument: (title: string, text: string) => void;
  refreshSession: () => void;
  setScanned: (code: string) => void;
  setDevice: (device: DeviceView) => void;
  setObjectTitle: (title: string | null) => void;
  setChanged: (update: (version: number) => number) => void;
  setBuilding: (update: (current: { id: string | null; version: number }) => { id: string | null; version: number }) => void;
}): ScreenContext => ({
  api: input.api,
  profile: input.profile,
  startParam: input.startParam,
  opened: input.opened,
  device: input.device,
  document: input.document,
  hidden: input.hidden,
  waiting: input.waiting,
  changed: input.changed,
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
  openBuilding: (id, next) => {
    input.setBuilding((current) => ({ id, version: current.version + 1 }));
    input.screens.open(next);
  },
});

/** Рабочая область: разделы, шапка и переходы между экранами. */
const Workspace = ({ api, profile, refreshSession, launched, offline }: WorkspaceProps) => {
  const haptics = useHaptics();
  const screens = useScreens();
  const [opened, setOpened] = useState<string | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);
  const [tip, setTip] = useState(false);
  const [agreed, setAgreed] = useState(accepted(profile));
  const [objectTitle, setObjectTitle] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(0);
  const [device, setDevice] = useState<DeviceView | null>(null);
  const [document, setDocument] = useState<{ title: string; text: string } | null>(null);
  const [changed, setChanged] = useState(0);

  const [building, setBuilding] = useState<{ id: string | null; version: number }>({ id: null, version: 0 });
  const { apartment, pick } = useApartment(api, () =>
    setBuilding((current) => ({ ...current, version: current.version + 1 })),
  );

  api.useBuilding(building.id);

  const offer = offerOf(profile);
  const launchedScreen = linkedScreen(scanned ?? launched, offer);
  // Ссылка на раздел кодом объекта не является: паспорт по ней не открывают,
  // и незнакомый раздел просто открывает приложение с начала.
  const startParam = isSectionParam(scanned ?? launched) ? undefined : (scanned ?? launched);
  const scrolled = useScrolled();
  const waiting = useWaiting(api, profile.role, changed + building.version + refreshed);
  const home = startScreen(profile);
  const { tour, endTour } = useTour(
    layoutSections(profile.role, profile.apartmentId !== null, offer).tabs,
    offer.demo,
  );

  useEffect(() => {
    if (launchedScreen) screens.seed([home, launchedScreen]);
    else if (startParam) screens.seed([home, 'object']);
  }, [launchedScreen, startParam, home, screens]);

  useBack(tip, () => setTip(false), screens);

  /** Переход на вкладку: стопка начинается заново, «назад» из корня некуда. */
  const openTab = (screen: Screen): void => {
    if (screen === 'help') {
      setTip(true);
      return;
    }

    haptics.picked();
    screens.open(screen);
  };

  const isStaff = profile.role !== 'resident';
  const bound = profile.apartmentId !== null;
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
  const openDocument = (title: string, text: string): void => {
    setDocument({ title, text });
    goDeeper('document');
  };

  const homeScreen = HOME_SCREENS.includes(screen);
  const { everything, tabs, hidden } = layoutSections(profile.role, bound, offer);

  const title = titleFor(screen, {
    object: objectTitle,
    device: device?.title ?? null,
    document: document?.title ?? null,
    section: everything.find((section) => section.screen === screen)?.title,
  });

  const picksBuilding = isStaff && !screens.deep && !homeScreen;
  const picksApartment = homeScreen || (!isStaff && !screens.deep);

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
    screens,
    goDeeper,
    openRequest,
    openDocument,
    refreshSession,
    setScanned,
    setDevice,
    setObjectTitle,
    setChanged,
    setBuilding,
  });

  const head = {
    api,
    title,
    scrolled,
    offline,
    ...(picksBuilding
      ? {
          building: {
            value: building.id,
            onChange: (id: string | null) => setBuilding((current) => ({ id, version: current.version + 1 })),
          },
        }
      : {}),
    ...(picksApartment ? { apartment: { value: apartment, onChange: pick } } : {}),
    onRefresh: (): void => {
      haptics.picked();
      setRefreshed((version) => version + 1);
    },
    // Помощник появляется в шапке после согласия: до него вопрос обрабатывать нечем.
    ...(agreed
      ? {
          onAssistant: (): void => {
            haptics.picked();
            setTip(true);
          },
        }
      : {}),
  };

  return (
    <Shell>
      <main>
        <TopBar {...head} />

        {/* Ключ перемонтирует экран, поэтому на форме заявки он не меняется:
            иначе нажатие «Обновить» стёрло бы набранный текст и снимки. */}
        <Fragment key={screen === 'new' ? 'new' : `${screen}-${building.version}-${refreshed}`}>
          {screenBody(screen, context)}
        </Fragment>
      </main>

      <TabBar sections={tabs} current={screen} waiting={waiting} hidden={hidden} onPick={openTab} />

      {tip ? (
        <Assistant
          api={api}
          onClose={() => setTip(false)}
          onGo={(target) => (target === 'new' ? goDeeper('new') : openTab(target as Screen))}
        />
      ) : null}

      <FirstRun
        api={api}
        agreed={agreed}
        tour={tour}
        onDocument={openDocument}
        onAgreed={() => setAgreed(true)}
        onTourDone={endTour}
      />
    </Shell>
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

  if (session.status === 'loading') {
    return (
      <Shell>
        <main>
          <Loading>Входим…</Loading>
        </main>
      </Shell>
    );
  }

  if (session.status === 'error') {
    return (
      <Shell>
        <main>
          <Empty icon={<IconHome />} title="Не получилось войти" hint={session.message}>
            <Button type="button" onClick={session.retry}>
              Попробовать снова
            </Button>
          </Empty>
        </main>
      </Shell>
    );
  }

  return (
    <Workspace
      api={api}
      profile={session.profile}
      refreshSession={session.refresh}
      launched={launch.initDataUnsafe.start_param ?? startParamFromUrl()}
      offline={offline}
    />
  );
};
