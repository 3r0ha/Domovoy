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

type Body = () => ReactNode;

/**
 * Какой экран за каким именем. Роль и обязательные данные проверяет сам раздел.
 */
const REGISTRY = (context: ScreenContext): Partial<Record<Screen, Body>> => {
  const { api, profile, changed } = context;
  const staff = profile.role !== 'resident';
  const contractor = profile.role === 'contractor';
  const manager = profile.role === 'manager';
  /** Кто ведёт очередь: он принимает заявки и заводит их по звонку. */
  const dispatcher = manager || profile.role === 'dispatcher';
  // Ссылка на чужой раздел открывается пояснением, а не пустой страницей и не отказом сервера.
  const elsewhere: Body = () => (
    <Empty mood="sleeping" title="Этот раздел не для вашей роли" hint="Откройте меню и выберите, что нужно" />
  );

  const forStaff = (body: Body): Body => (staff ? body : elsewhere);
  const forCompany = (body: Body): Body => (staff && !contractor ? body : elsewhere);
  const forManager = (body: Body): Body => (manager ? body : elsewhere);
  const forDispatcher = (body: Body): Body => (dispatcher ? body : elsewhere);

  return {
    more: () => <MoreScreen sections={context.hidden} waiting={context.waiting} onPick={context.goDeeper} />,

    bind: () => (
      <BindApartmentScreen
        api={api}
        onBound={() => {
          context.open('list');
          context.refreshSession();
        }}
      />
    ),

    object: () =>
      context.startParam ? (
        <ObjectScreen
          api={api}
          startParam={context.startParam}
          onTitle={context.onObjectTitle}
          onReport={() => context.goDeeper('new')}
          onOpenRequest={context.openRequest}
        />
      ) : null,

    home: () => (
      <HomeScreen
        api={api}
        staff={staff}
        model={(profile.model ?? []).includes('doors')}
        onCamera={(picked) => context.openDevice(picked, 'camera')}
        onGuest={(picked) => context.openDevice(picked, 'guest')}
        onJournal={() => context.goDeeper('journal')}
        onScan={context.openScanned}
      />
    ),

    camera: () => (context.device ? <CameraScreen api={api} device={context.device} /> : null),
    guest: () => (context.device ? <GuestScreen api={api} device={context.device} /> : null),
    journal: () => <JournalScreen api={api} />,

    new: () => (
      <NewRequestScreen
        api={api}
        startParam={context.startParam}
        staff={staff && !contractor}
        {...(!staff && profile.apartmentNumber ? { where: `Квартира ${profile.apartmentNumber}` } : {})}
        onCreated={(requestId?: string) => (requestId ? context.openRequest(requestId) : context.open('list'))}
        onSupport={() => context.open('support')}
      />
    ),

    list: () => (
      <RequestListScreen
        key={changed}
        api={api}
        staff={staff}
        onNewRequest={() => context.goDeeper('new')}
        onOpen={context.openRequest}
      />
    ),

    request: () =>
      context.opened ? (
        <RequestScreen
          api={api}
          id={context.opened}
          staff={staff}
          onDocument={context.openDocument}
          onChanged={context.onRequestChanged}
        />
      ) : null,

    meters: () => (
      <MetersScreen
        api={api}
        readingWindow={profile.readingWindow}
        {...(profile.meterPhoto ? { photoSupported: true } : {})}
        payable={profile.payments !== false}
        paymentsModel={(profile.model ?? []).includes('payments')}
        onBind={() => context.open('bind')}
      />
    ),

    news: () => <AnnouncementsScreen api={api} showReach={staff} />,

    broadcast: forDispatcher(() => <BroadcastScreen api={api} />),

    profile: () => (
      <ProfileScreen
        api={api}
        displayName={profile.displayName}
        bound={profile.apartmentId !== null}
        {...(profile.apartmentNumber
          ? { where: [`Квартира ${profile.apartmentNumber}`, profile.address].filter(Boolean).join(' · ') }
          : {})}
        {...(profile.phone ? { phone: profile.phone } : {})}
        {...(profile.elder ? { elder: profile.elder } : {})}
        {...(staff && profile.onDuty !== undefined
          ? { duty: { residentId: profile.id, onDuty: profile.onDuty } }
          : {})}
        {...(profile.apartmentId && profile.apartmentNumber
          ? {
              flat: {
                residentId: profile.id,
                apartmentId: profile.apartmentId,
                title: `Квартиру ${profile.apartmentNumber}`,
              },
            }
          : {})}
        onDocument={context.openDocument}
        onForgotten={context.refreshSession}
        onUnbound={context.refreshSession}
      />
    ),

    demo: () => (profile.demo === true ? <DemoScreen api={api} onSwitched={context.refreshSession} /> : null),

    polls: () => (
      <PollsScreen api={api} canStart={staff} onDocument={context.openDocument} onBind={() => context.open('bind')} />
    ),
    support: () => <SupportScreen api={api} staff={staff} />,
    visits: () => (
      <VisitsScreen api={api} staff={staff && !contractor} onSupport={() => context.open('support')} />
    ),
    stickers: () => <StickersScreen api={api} staff={staff} />,
    quality: () => <QualityScreen api={api} />,

    document: () =>
      context.document ? <DocumentScreen text={context.document.text} onBack={context.back} /> : null,

    queue: forCompany(() => (
      <QueueScreen
        key={changed}
        api={api}
        {...(dispatcher ? { canAccept: true } : {})}
        onOpen={context.openRequest}
        onNewRequest={() => context.goDeeper('new')}
      />
    )),
    report: forCompany(() => <ReportScreen api={api} toChat={profile.files !== false} />),
    plan: forCompany(() => <PlanScreen api={api} onOpen={context.openRequest} />),
    inspections: forCompany(() => <InspectionsScreen api={api} onOpen={context.openRequest} />),

    buildings: forCompany(() => (
      <BuildingsScreen
        api={api}
        canAdd={manager}
        onPick={(id) => context.openBuilding(id, 'queue')}
        onAdd={(id) => context.openBuilding(id, 'import')}
      />
    )),

    equipment: forStaff(() => <EquipmentScreen api={api} onOpen={context.openScanned} />),

    tariffs: forStaff(() => <TariffsScreen api={api} {...(manager ? { editable: true } : {})} />),
    'house-meters': forCompany(() => (
      <HouseMetersScreen api={api} toChat={profile.files !== false} {...(manager ? { canAdd: true } : {})} />
    )),
    debtors: forCompany(() => <DebtorsScreen api={api} />),
    residents: forCompany(() => <ResidentsScreen api={api} canAssignRoles={manager} />),

    audit: forManager(() => <AuditScreen api={api} />),
    import: forManager(() => <ImportScreen api={api} />),
  };
};

/** Тело текущего экрана. Неизвестному имени соответствует пустая страница. */
export const screenBody = (screen: Screen, context: ScreenContext): ReactNode => REGISTRY(context)[screen]?.() ?? null;
