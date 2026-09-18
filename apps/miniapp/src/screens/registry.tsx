import { Button } from '@maxhub/max-ui';
import { type ReactNode } from 'react';

import { type DomovoyApi, type DeviceView, type Profile } from '../api.js';
import { type Screen } from '../navigation.js';
import type { Waiting } from '../App.js';
import { type Section } from '../sections.js';
import { AnnouncementsScreen } from './AnnouncementsScreen.js';
import { AuditScreen } from './AuditScreen.js';
import { BindApartmentScreen } from './BindApartmentScreen.js';
import { BroadcastScreen } from './BroadcastScreen.js';
import { BuildingsScreen } from './BuildingsScreen.js';
import { CapitalRepairScreen } from './CapitalRepairScreen.js';
import { CameraScreen } from './CameraScreen.js';
import { DebtorsScreen } from './DebtorsScreen.js';
import { DemoScreen } from './DemoScreen.js';
import { DocumentScreen } from './DocumentScreen.js';
import { Empty } from './Empty.js';
import { EquipmentScreen } from './EquipmentScreen.js';
import { GuestScreen } from './GuestScreen.js';
import { HomeScreen } from './HomeScreen.js';
import { HouseMetersScreen } from './HouseMetersScreen.js';
import { ImportScreen } from './ImportScreen.js';
import { InspectionsScreen } from './InspectionsScreen.js';
import { JournalScreen } from './JournalScreen.js';
import { MetersScreen } from './MetersScreen.js';
import { MoreScreen } from './TabBar.js';
import { NewRequestScreen } from './NewRequestScreen.js';
import { ObjectScreen } from './ObjectScreen.js';
import { PlanScreen } from './PlanScreen.js';
import { PollsScreen } from './PollsScreen.js';
import { ProfileScreen } from './ProfileScreen.js';
import { QualityScreen } from './QualityScreen.js';
import { QueueScreen } from './QueueScreen.js';
import { ReportScreen } from './ReportScreen.js';
import { RequestListScreen } from './RequestListScreen.js';
import { RequestScreen } from './RequestScreen.js';
import { ResidentsScreen } from './ResidentsScreen.js';
import { StickersScreen } from './StickersScreen.js';
import { SupportScreen } from './SupportScreen.js';
import { TariffsScreen } from './TariffsScreen.js';
import { VisitsScreen } from './VisitsScreen.js';

/** Всё, что экраны просят у приложения: данные сессии и переходы. */
export interface ScreenContext {
  api: DomovoyApi;
  profile: Profile;
  /** Код объекта с наклейки или из адреса стенда. */
  startParam: string | undefined;
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
  <Empty mood="sleeping" title="Раздел недоступен">
    <Button type="button" onClick={() => context.open('more')}>
      В меню
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

  bind: (context) => (
    <BindApartmentScreen
      api={context.api}
      onSupport={() => context.open('support')}
      onBound={() => {
        context.open('list');
        context.refreshSession();
      }}
    />
  ),

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
      startParam={context.startParam}
      staff={isStaff(context.profile) && !isContractor(context.profile)}
      {...(!isStaff(context.profile) && context.profile.apartmentNumber
        ? { where: `Квартира ${context.profile.apartmentNumber}` }
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
            where: [`Квартира ${context.profile.apartmentNumber}`, context.profile.address]
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
              title: `Квартиру ${context.profile.apartmentNumber}`,
            },
          }
        : {})}
      onDocument={context.openDocument}
      onForgotten={context.refreshSession}
      onUnbound={context.refreshSession}
    />
  ),

  demo: (context) =>
    context.profile.demo === true ? <DemoScreen api={context.api} onSwitched={context.refreshSession} /> : null,

  polls: (context) => (
    <PollsScreen
      api={context.api}
      canStart={isStaff(context.profile)}
      onDocument={context.openDocument}
      onBind={() => context.open('bind')}
    />
  ),
  support: (context) => <SupportScreen api={context.api} staff={isStaff(context.profile)} />,
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
export const screenBody = (screen: Screen, context: ScreenContext): ReactNode => REGISTRY[screen]?.(context) ?? null;
