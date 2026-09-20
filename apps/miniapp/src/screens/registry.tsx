import { Button } from '@maxhub/max-ui';
import { lazy, Suspense, type ReactNode } from 'react';

import { type DomovoyApi, type DeviceView, type Profile } from '../api.js';
import { say } from '../i18n.js';
import { type Screen } from '../navigation.js';
import type { Waiting } from '../App.js';
import { type Section } from '../sections.js';
import { AnnouncementsScreen } from './AnnouncementsScreen.js';
import { BindApartmentScreen } from './BindApartmentScreen.js';
import { CapitalRepairScreen } from './CapitalRepairScreen.js';
import { CameraScreen } from './CameraScreen.js';
import { DemoScreen } from './DemoScreen.js';
import { DocumentScreen } from './DocumentScreen.js';
import { Empty } from './Empty.js';
import { GuestScreen } from './GuestScreen.js';
import { HomeScreen } from './HomeScreen.js';
import { JournalScreen } from './JournalScreen.js';
import { LanguageScreen } from './LanguageScreen.js';
import { MetersScreen } from './MetersScreen.js';
import { MoreScreen } from './TabBar.js';
import { NewRequestScreen } from './NewRequestScreen.js';
import { ObjectScreen } from './ObjectScreen.js';
import { PollsScreen } from './PollsScreen.js';
import { ProfileScreen } from './ProfileScreen.js';
import { QualityScreen } from './QualityScreen.js';
import { RequestListScreen } from './RequestListScreen.js';
import { RequestScreen } from './RequestScreen.js';
import { Skeleton } from './Skeleton.js';
import { StickersScreen } from './StickersScreen.js';
import { SupportScreen } from './SupportScreen.js';
import { VisitsScreen } from './VisitsScreen.js';

/*
 * Разделы смены идут отдельными кусками сборки. Жилец их не открывает, а на
 * слабой связи он ждёт своего первого экрана вместе с ними.
 */
const AuditScreen = lazy(async () => ({ default: (await import('./AuditScreen.js')).AuditScreen }));
const BroadcastScreen = lazy(async () => ({ default: (await import('./BroadcastScreen.js')).BroadcastScreen }));
const BuildingsScreen = lazy(async () => ({ default: (await import('./BuildingsScreen.js')).BuildingsScreen }));
const DebtorsScreen = lazy(async () => ({ default: (await import('./DebtorsScreen.js')).DebtorsScreen }));
const EquipmentScreen = lazy(async () => ({ default: (await import('./EquipmentScreen.js')).EquipmentScreen }));
const HouseMetersScreen = lazy(async () => ({ default: (await import('./HouseMetersScreen.js')).HouseMetersScreen }));
const ImportScreen = lazy(async () => ({ default: (await import('./ImportScreen.js')).ImportScreen }));
const InspectionsScreen = lazy(async () => ({ default: (await import('./InspectionsScreen.js')).InspectionsScreen }));
const PlanScreen = lazy(async () => ({ default: (await import('./PlanScreen.js')).PlanScreen }));
const QueueScreen = lazy(async () => ({ default: (await import('./QueueScreen.js')).QueueScreen }));
const ReportScreen = lazy(async () => ({ default: (await import('./ReportScreen.js')).ReportScreen }));
const ResidentsScreen = lazy(async () => ({ default: (await import('./ResidentsScreen.js')).ResidentsScreen }));
const TariffsScreen = lazy(async () => ({ default: (await import('./TariffsScreen.js')).TariffsScreen }));

/** Всё, что экраны просят у приложения: данные сессии и переходы. */
export interface ScreenContext {
  api: DomovoyApi;
  profile: Profile;
  /** Код объекта с наклейки или из адреса стенда. */
  startParam: string | undefined;
  /** Тот же код для новой заявки: только пока человек пришёл с паспорта объекта. */
  reportedObject: string | undefined;
  /** Заявка, открытая на своём экране. */
  opened: string | null;
  device: DeviceView | null;
  document: { title: string; text: string } | null;
  /** Разделы, не поместившиеся в панель: их показывает «Ещё». */
  hidden: readonly Section[];
  /** Сколько дел ждёт человека по разделам. */
  waiting: Waiting;
  /** Счётчик изменений заявки: по нему списки перечитываются. */
  changed: number;
  /** Куда вернёт «назад»: название экрана под текущим. */
  backTitle: string;
  /** Есть куда возвращаться: экран открыт поверх другого. */
  deep: boolean;
  /** Начать стопку заново с этого экрана. */
  open: (screen: Screen) => void;
  /** Перейти вглубь: «назад» вернёт туда, откуда пришли. */
  goDeeper: (screen: Screen) => void;
  back: () => void;
  openRequest: (id: string) => void;
  openDocument: (title: string, text: string) => void;
  /** Отсканированный код объекта ведёт на его паспорт. */
  openScanned: (code: string) => void;
  openDevice: (device: DeviceView, screen: 'camera' | 'guest') => void;
  onObjectTitle: (title: string | null) => void;
  onRequestChanged: () => void;
  /** Сессию нужно перечитать: изменились квартира, роль или согласия. */
  refreshSession: () => void;
  /** Поправить профиль на месте: сохранённый телефон виден сразу и после возврата. */
  patchProfile: (update: (profile: Profile) => Profile) => void;
  /** Работать с другим домом и уйти на его экран. */
  openBuilding: (buildingId: string, screen: Screen) => void;
}

type Body = (context: ScreenContext) => ReactNode;

const isStaff = (profile: Profile): boolean => profile.role !== 'resident';
const isContractor = (profile: Profile): boolean => profile.role === 'contractor';
const isManager = (profile: Profile): boolean => profile.role === 'manager';
/** Кто ведёт очередь: он принимает заявки и заводит их по звонку. */
const isDispatcher = (profile: Profile): boolean => isManager(profile) || profile.role === 'dispatcher';
/** Кто работает руками: такой берёт наряд на себя, исполнителя выбирать не надо. */
const isExecutor = (profile: Profile): boolean =>
  profile.role === 'technician' || profile.role === 'contractor';

// Ссылка на чужой раздел открывается пояснением, а не пустой страницей и не отказом сервера.
const elsewhere: Body = (context) => (
  <Empty mood="sleeping" title={say('chrome.section.denied')}>
    <Button type="button" onClick={() => context.open('more')}>
      {say('chrome.section.menu')}
    </Button>
  </Empty>
);

/** Раздел, закрытый для роли, показывает пояснение. */
const allowed = (rule: (profile: Profile) => boolean, body: Body): Body => (context) =>
  rule(context.profile) ? body(context) : elsewhere(context);

const forStaff = (body: Body): Body => allowed(isStaff, body);
const forCompany = (body: Body): Body => allowed((profile) => isStaff(profile) && !isContractor(profile), body);
const forManager = (body: Body): Body => allowed(isManager, body);
const forDispatcher = (body: Body): Body => allowed(isDispatcher, body);

/**
 * Какой экран за каким именем. Карта собирается один раз: роль и обязательные
 * данные проверяет сам раздел, когда его просят нарисовать.
 */
const REGISTRY: Partial<Record<Screen, Body>> = {
  more: (context) => <MoreScreen sections={context.hidden} waiting={context.waiting} onPick={context.goDeeper} />,

  bind: (context) => {
    // У жильца без квартиры дома нет: ни контактов, ни поддержки. Ему с этого
    // экрана открыты только профиль с документами и, на проверке, роль.
    const housed = isStaff(context.profile) || context.profile.apartmentId !== null;

    return (
      <BindApartmentScreen
        api={context.api}
        housed={housed}
        {...(housed
          ? { onSupport: () => context.open('support') }
          : {
              onProfile: () => context.goDeeper('profile'),
              onLanguage: () => context.goDeeper('language'),
              ...(context.profile.demo === true ? { onDemo: () => context.goDeeper('demo') } : {}),
            })}
        onBound={() => {
          context.open('list');
          context.refreshSession();
        }}
      />
    );
  },

  object: (context) =>
    context.startParam ? (
      <ObjectScreen
        api={context.api}
        startParam={context.startParam}
        onTitle={context.onObjectTitle}
        onReport={() => context.goDeeper('new')}
        onOpenRequest={context.openRequest}
      />
    ) : null,

  home: (context) => (
    <HomeScreen
      api={context.api}
      staff={isStaff(context.profile)}
      model={(context.profile.model ?? []).includes('doors')}
      onCamera={(picked) => context.openDevice(picked, 'camera')}
      onGuest={(picked) => context.openDevice(picked, 'guest')}
      onJournal={() => context.goDeeper('journal')}
      onScan={context.openScanned}
    />
  ),

  camera: (context) => (context.device ? <CameraScreen api={context.api} device={context.device} /> : null),
  guest: (context) => (context.device ? <GuestScreen api={context.api} device={context.device} /> : null),
  journal: (context) => <JournalScreen api={context.api} />,

  new: (context) => (
    <NewRequestScreen
      api={context.api}
      startParam={context.reportedObject}
      staff={isStaff(context.profile) && !isContractor(context.profile)}
      {...(!isStaff(context.profile) && context.profile.apartmentNumber
        ? { where: say('chrome.flat', { номер: context.profile.apartmentNumber }) }
        : {})}
      onCreated={(requestId?: string) => (requestId ? context.openRequest(requestId) : context.open('list'))}
      onSupport={() => context.open('support')}
    />
  ),

  list: (context) => (
    <RequestListScreen
      api={context.api}
      staff={isStaff(context.profile)}
      version={context.changed}
      {...(isStaff(context.profile) && !isContractor(context.profile) ? { onQueue: () => context.open('queue') } : {})}
      onNewRequest={() => context.goDeeper('new')}
      onOpen={context.openRequest}
    />
  ),

  request: (context) =>
    context.opened ? (
      <RequestScreen
        api={context.api}
        id={context.opened}
        staff={isStaff(context.profile)}
        meId={context.profile.id}
        meName={context.profile.displayName}
        {...(isExecutor(context.profile) ? { selfAssigned: true } : {})}
        onDocument={context.openDocument}
        onChanged={context.onRequestChanged}
        onBack={context.back}
        backTitle={context.backTitle}
      />
    ) : null,

  meters: (context) => (
    <MetersScreen
      api={context.api}
      readingWindow={context.profile.readingWindow}
      {...(context.profile.meterPhoto ? { photoSupported: true } : {})}
      payable={context.profile.payments !== false}
      paymentsModel={(context.profile.model ?? []).includes('payments')}
      onBind={() => context.open('bind')}
      onSupport={() => context.open('support')}
    />
  ),

  news: (context) => <AnnouncementsScreen api={context.api} showReach={isStaff(context.profile)} />,

  broadcast: forDispatcher((context) => <BroadcastScreen api={context.api} />),

  profile: (context) => (
    <ProfileScreen
      api={context.api}
      displayName={context.profile.displayName}
      bound={context.profile.apartmentId !== null}
      {...(context.profile.apartmentNumber
        ? {
            where: [say('chrome.flat', { номер: context.profile.apartmentNumber }), context.profile.address]
              .filter(Boolean)
              .join(' · '),
          }
        : {})}
      {...(context.profile.phone ? { phone: context.profile.phone } : {})}
      {...(context.profile.elder ? { elder: context.profile.elder } : {})}
      {...(isStaff(context.profile) && context.profile.onDuty !== undefined
        ? { duty: { residentId: context.profile.id, onDuty: context.profile.onDuty } }
        : {})}
      {...(context.profile.apartmentId && context.profile.apartmentNumber
        ? {
            flat: {
              residentId: context.profile.id,
              apartmentId: context.profile.apartmentId,
              title: say('chrome.flat.leaving', { номер: context.profile.apartmentNumber }),
            },
          }
        : {})}
      onDocument={context.openDocument}
      onForgotten={context.refreshSession}
      onUnbound={context.refreshSession}
      onPhone={(phone) => context.patchProfile((profile) => ({ ...profile, phone: phone || undefined }))}
    />
  ),

  demo: (context) =>
    context.profile.demo === true ? <DemoScreen api={context.api} onSwitched={context.refreshSession} /> : null,

  language: (context) => (
    <LanguageScreen
      api={context.api}
      {...(context.profile.language ? { current: context.profile.language } : {})}
      onPicked={(language) => context.patchProfile((profile) => ({ ...profile, language }))}
    />
  ),

  polls: (context) => (
    <PollsScreen
      api={context.api}
      canStart={isStaff(context.profile)}
      onDocument={context.openDocument}
      onBind={() => context.open('bind')}
    />
  ),
  support: (context) => (
    <SupportScreen
      api={context.api}
      staff={isStaff(context.profile)}
      {...(context.deep ? { onBack: context.back, backTitle: context.backTitle } : {})}
      onChanged={context.onRequestChanged}
    />
  ),
  visits: (context) => (
    <VisitsScreen
      api={context.api}
      staff={isStaff(context.profile) && !isContractor(context.profile)}
      {...(isManager(context.profile) ? { canSchedule: true } : {})}
      onSupport={() => context.open('support')}
    />
  ),
  stickers: (context) => <StickersScreen api={context.api} staff={isStaff(context.profile)} />,
  quality: (context) => <QualityScreen api={context.api} />,

  document: (context) =>
    context.document ? <DocumentScreen text={context.document.text} onBack={context.back} /> : null,

  queue: forCompany((context) => (
    <QueueScreen
      api={context.api}
      version={context.changed}
      {...(isDispatcher(context.profile) ? { canAccept: true } : {})}
      onOpen={context.openRequest}
      onNewRequest={() => context.goDeeper('new')}
    />
  )),
  report: forCompany((context) => <ReportScreen api={context.api} toChat={context.profile.files !== false} />),
  plan: forCompany((context) => <PlanScreen api={context.api} onOpen={context.openRequest} />),
  inspections: forCompany((context) => <InspectionsScreen api={context.api} onOpen={context.openRequest} />),

  buildings: forCompany((context) => (
    <BuildingsScreen
      api={context.api}
      canAdd={isManager(context.profile)}
      opens={isManager(context.profile) ? 'card' : 'queue'}
      onPick={(id) => context.openBuilding(id, isManager(context.profile) ? 'import' : 'queue')}
      onAdd={(id) => context.openBuilding(id, 'import')}
    />
  )),

  equipment: forStaff((context) => <EquipmentScreen api={context.api} onOpen={context.openScanned} />),

  tariffs: forStaff((context) => (
    <TariffsScreen api={context.api} {...(isManager(context.profile) ? { editable: true } : {})} />
  )),
  'house-meters': forCompany((context) => (
    <HouseMetersScreen
      api={context.api}
      toChat={context.profile.files !== false}
      {...(isManager(context.profile) ? { canAdd: true } : {})}
    />
  )),
  capital: (context) => <CapitalRepairScreen api={context.api} />,
  debtors: forCompany((context) => <DebtorsScreen api={context.api} />),
  residents: forCompany((context) => <ResidentsScreen api={context.api} canAssignRoles={isManager(context.profile)} />),

  audit: forManager((context) => <AuditScreen api={context.api} />),
  import: forManager((context) => <ImportScreen api={context.api} />),
};

/** Тело текущего экрана. Неизвестному имени соответствует пустая страница. */
export const screenBody = (screen: Screen, context: ScreenContext): ReactNode => {
  const body = REGISTRY[screen]?.(context) ?? null;

  // Пока кусок раздела едет, на экране скелет, а не пустота.
  return body === null ? null : <Suspense fallback={<Skeleton count={3} />}>{body}</Suspense>;
};
