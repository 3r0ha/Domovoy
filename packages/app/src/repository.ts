import type {
  AnnouncementAudience,
  Apartment,
  CreateRequestInput,
  Eldership,
  EquipmentKind,
  Handoff,
  HandoffTarget,
  HouseMeter,
  Initiative,
  Inspection,
  Meter,
  MeterKind,
  NoticeKind,
  PlannedWork,
  Poll,
  Reading,
  RequestCategory,
  ReceptionWindow,
  RequestStatus,
  Role,
  ServiceRequest,
  SupportTicket,
  TicketStatus,
  Visit,
  VisitStatus,
  Vote,
} from '@domovoy/domain';
import type { Language } from '@domovoy/i18n';

import type { AuditAction } from './audit.js';

/** Право собственности на помещение: доля 1 означает, что оно целиком его. */
export interface OwnedApartment {
  apartmentId: string;
  share: number;
  /** Чем подтверждено: выписка, договор, слова самого человека. */
  basis?: 'stated' | 'company';
}

export interface Resident {
  id: string;
  /** Аккаунт в MAX. У обезличенного профиля его нет. */
  maxUserId?: number;
  displayName: string;
  /**
   * Имя человек задал сам. Тогда имя из платформы его не перебивает: в профиле
   * MAX у людей стоят никнеймы, и смене от «xXx_kotik_xXx» толку нет, а
   * подставлять его заново поверх выбранного имени тем более незачем.
   */
  nameByUser?: boolean;
  role: Role;
  /** Квартира, с которой человек работает сейчас: показания, квитанция, голос. */
  apartmentId?: string;
  /** Все привязанные квартиры, включая текущую. У одного человека их может быть несколько. */
  apartmentIds?: string[];
  /**
   * Помещения, в которых человек собственник, и его доля в каждом. Голос на
   * собрании и подпись под требованием созыва идут отсюда: наниматель и член
   * семьи живут в квартире, но голоса не имеют.
   */
  owned?: OwnedApartment[];
  buildingId?: string;
  /** Дома, которые обслуживает сотрудник, кроме своего. */
  servesBuildingIds?: string[];
  /** Сотрудник на дежурстве. */
  onDuty?: boolean;
  /** Когда профиль обезличен по требованию человека. */
  forgottenAt?: Date;
  /** Что человек отключил. Аварии и свои заявки в этот список не попадают. */
  mutes?: NoticeKind[];
  /** Телефон, если человек им поделился. */
  phone?: string;
  /** Редакция документов, с которой человек согласился. */
  legalVersion?: string;
  /** Язык, на котором продукт с ним говорит. Пусто: язык ещё не выбран. */
  language?: Language;
  /** Когда согласие получено. */
  legalAt?: Date;
}

export interface Announcement {
  id: string;
  buildingId: string;
  audience: { kind: 'building' | 'entrance' | 'riser'; entrance?: number; riser?: number };
  title: string;
  body: string;
  createdAt: Date;
  recipientIds: string[];
  /** Плановые работы, если объявление о них. Ресурс известен у отключений: по нему считается перерасчёт. */
  works?: { category: RequestCategory; from: Date; until: Date; resource?: MeterKind };
  /** Заявка, из-за которой объявление и появилось. */
  requestId?: string;
  /**
   * Когда объявление разослать. Заполнено, пока рассылка ждёт утра: ночью
   * будят только аварии и работы, которые уже начались.
   */
  deliverAt?: Date;
}

/** Адресат объявления в виде, понятном правилам. */
export const announcementAudience = (announcement: Announcement): AnnouncementAudience => {
  const { kind, entrance, riser } = announcement.audience;

  if (kind === 'riser' && entrance !== undefined && riser !== undefined) {
    return { kind, buildingId: announcement.buildingId, entrance, riser };
  }

  if (kind === 'entrance' && entrance !== undefined) {
    return { kind, buildingId: announcement.buildingId, entrance };
  }

  return { kind: 'building', buildingId: announcement.buildingId };
};

/** Объявление о плановых работах в виде, понятном правилам. */
export const plannedWork = (announcement: Announcement): PlannedWork | undefined =>
  announcement.works
    ? {
        id: announcement.id,
        title: announcement.title,
        category: announcement.works.category,
        audience: announcementAudience(announcement),
        from: announcement.works.from,
        until: announcement.works.until,
      }
    : undefined;

/** Общее оборудование дома: лифт, домофон, узел учёта. */
export interface Equipment {
  /** Код с наклейки: он же попадает в ссылку. */
  code: string;
  buildingId: string;
  /** Как оборудование называют люди: «Лифт, подъезд 1». */
  title: string;
  /** Вид: от него зависит регламент обслуживания. */
  kind?: EquipmentKind;
}

/** Файл, приложенный к обращению. */
export interface StoredFile {
  id: string;
  contentType: string;
  bytes: Uint8Array;
  /** Кто прислал файл. */
  uploadedBy: string;
  /** Дом, к которому относится файл: сотрудники этого дома его видят. */
  buildingId: string;
  at: Date;
}

/** Ответственный по дому: к нему идут с тем, что бот и приложение не решают. */
export interface HouseContact {
  /** Фамилия, имя и отчество. */
  name: string;
  /** Должность: «старший инженер», «управляющий». */
  role?: string;
  phone?: string;
  email?: string;
}

/** Кто ещё участвует в обслуживании дома, кроме управляющей организации. */
export interface HousePartner {
  /** Зона: ресурс, подрядчик по договору, муниципальная служба, надзор. */
  kind: HandoffTarget;
  title: string;
  /** Какие обращения к ней относятся. Пусто означает «любые в своей зоне». */
  categories?: RequestCategory[];
  phone?: string;
  email?: string;
  /** Чем передаётся обращение: `gis_zhkh`, `pos`, `email`, `phone`. */
  channel?: string;
}

/** Какие переданные обращения читаем. */
export interface HandoffFilter {
  requestId?: string;
  buildingId?: string;
  /** Только те, по которым ответа ещё нет. */
  waiting?: boolean;
}

/**
 * Сведения об обслуживании дома. Держать их доступными жильцу в MAX обязывает
 * порядок информационного взаимодействия (приказ Минстроя России № 856/пр).
 */
export interface HouseService {
  /** Телефон аварийно-диспетчерской службы: круглосуточный. */
  emergencyPhone?: string;
  /** Телефон управляющей организации. */
  phone?: string;
  email?: string;
  /** Режим работы организации: «пн-пт 9:00-18:00». */
  hours?: string;
  /** Адрес центра обслуживания жильцов. */
  office?: string;
  /** Часы приёма в центре обслуживания. */
  officeHours?: string;
}

export interface Building {
  id: string;
  /** Короткий код для номера заявки, например «Д15». */
  code: string;
  address: string;
  /** Кто обслуживает дом. Нужна обращению в жилищную инспекцию. */
  managementCompany?: string;
  /** К кому обращаться по дому: ответственный от управляющей организации. */
  contact?: HouseContact;
  /** Телефоны, режим работы и адрес приёма. */
  service?: HouseService;
  /** Смежные организации: к ним уходят обращения не из зоны управляющей. */
  partners?: HousePartner[];
  /** Приёмные окна: в них жилец записывается на приём. */
  reception?: ReceptionWindow[];
  /** Сколько минут занимает один приём. Без него берётся получас. */
  visitMinutes?: number;
  /** Владелец дома в установке: сотрудники одной организации не видят дома другой. */
  companyId?: string;
  /** Часовой пояс дома, название по IANA. */
  timeZone?: string;
  /** Чат дома в MAX: общедомовое объявление попадает и туда. */
  chatId?: number;
}

export interface RequestFilter {
  buildingId?: string;
  authorId?: string;
  /** Заявки, о которых житель сообщал: свои и те, к которым присоединился. */
  reporterId?: string;
  /** Заявки, порученные человеку. */
  assigneeId?: string;
  statuses?: RequestStatus[];
  /** Только заведённые после этого момента: окно для счётчиков и страниц. */
  createdAfter?: Date;
  /** Только заведённые до этого момента: курсор постраничного чтения. */
  createdBefore?: Date;
  /** Сколько отдать, начиная со свежих. */
  limit?: number;
}

/** Какие записи на приём читаем. */
export interface VisitFilter {
  buildingId?: string;
  residentId?: string;
  /** Только начинающиеся не раньше этого момента. */
  from?: Date;
  statuses?: VisitStatus[];
}

/** Чьи обращения читаем. */
export interface SupportFilter {
  buildingId?: string;
  residentId?: string;
  statuses?: TicketStatus[];
}

/** Машинный перевод одного текста на один язык. */
export interface StoredTranslation {
  /** Отпечаток исходного текста. */
  fingerprint: string;
  language: Language;
  /** Перевод. Пусто: служба не перевела, и какое-то время её не спрашивают снова. */
  text?: string;
  at: Date;
}

/** Доступ к данным. */
export interface Repository {
  findResidentByMaxUserId(maxUserId: number): Promise<Resident | undefined>;
  findResident(id: string): Promise<Resident | undefined>;
  /** Жильцы указанных квартир: адресат объявления. */
  listResidentsByApartments(apartmentIds: readonly string[]): Promise<Resident[]>;
  /** Своя смена дома: им уходят новые заявки. Подрядчик сюда не входит. */
  listStaff(buildingId: string): Promise<Resident[]>;
  /** Управляющие всех домов: им уходят заявки домов без закреплённой смены. */
  listManagers(): Promise<Resident[]>;
  saveResident(resident: Resident): Promise<Resident>;

  saveBuilding(building: Building): Promise<void>;
  saveApartment(apartment: Apartment): Promise<void>;
  listApartments(buildingId: string): Promise<Apartment[]>;
  findApartment(apartmentId: string): Promise<Apartment | undefined>;
  /** Квартира по коду из квитанции. */
  findApartmentByCode(code: string): Promise<Apartment | undefined>;

  saveFile(file: StoredFile): Promise<void>;
  findFile(id: string): Promise<StoredFile | undefined>;

  saveEquipment(equipment: Equipment): Promise<void>;
  listEquipment(buildingId: string): Promise<Equipment[]>;
  findEquipment(buildingId: string, code: string): Promise<Equipment | undefined>;

  /** Следующий порядковый номер заявки в доме за месяц. */
  nextRequestSequence(buildingId: string, at: Date): Promise<number>;
  buildingCode(buildingId: string): Promise<string | undefined>;
  findBuilding(buildingId: string): Promise<Building | undefined>;
  /** Все дома управляющей организации. */
  listBuildings(): Promise<Building[]>;

  createRequest(input: CreateRequestInput): Promise<ServiceRequest>;
  saveRequest(request: ServiceRequest): Promise<ServiceRequest>;
  findRequest(id: string): Promise<ServiceRequest | undefined>;
  listRequests(filter: RequestFilter): Promise<ServiceRequest[]>;

  saveAnnouncement(announcement: Announcement): Promise<Announcement>;
  listAnnouncements(buildingId: string): Promise<Announcement[]>;
  /** Работы, которые шли в доме хоть в какой-то момент промежутка. */
  listWorksBetween(buildingId: string, from: Date, to: Date): Promise<Announcement[]>;

  /** Жильцы, не связанные ни с одной квартирой. */
  listUnboundResidents(): Promise<Resident[]>;
  /** Все, кто связан с домом: и жильцы, и сотрудники. */
  listResidents(buildingId: string): Promise<Resident[]>;

  savePoll(poll: Poll): Promise<Poll>;
  findPoll(pollId: string): Promise<Poll | undefined>;
  listPolls(buildingId: string): Promise<Poll[]>;
  saveVote(vote: Vote): Promise<Vote>;
  listVotes(pollId: string): Promise<Vote[]>;

  /** Полномочия старшего по подъезду со сроком их действия. */
  saveEldership(eldership: Eldership): Promise<Eldership>;
  listElderships(buildingId: string): Promise<Eldership[]>;

  saveInitiative(initiative: Initiative): Promise<Initiative>;
  findInitiative(id: string): Promise<Initiative | undefined>;
  listInitiatives(buildingId: string): Promise<Initiative[]>;

  saveMeter(meter: Meter): Promise<Meter>;
  listMeters(apartmentId: string): Promise<Meter[]>;
  /** Приборы сразу всех перечисленных квартир. */
  listMetersByApartments(apartmentIds: readonly string[]): Promise<Meter[]>;
  findMeter(meterId: string): Promise<Meter | undefined>;
  saveReading(reading: Reading): Promise<Reading>;
  /** История показаний прибора, свежие первыми. */
  listReadings(meterId: string): Promise<Reading[]>;
  /** История сразу нескольких приборов, свежие первыми. */
  listReadingsFor(meterIds: readonly string[]): Promise<Reading[]>;
  /** Убрать показание: им исправляют опечатку в поданном за этот месяц. */
  deleteReading(readingId: string): Promise<void>;

  saveHouseMeter(meter: HouseMeter): Promise<HouseMeter>;
  /** Общедомовые приборы: узел учёта на вводе дома. */
  listHouseMeters(buildingId: string): Promise<HouseMeter[]>;
  findHouseMeter(meterId: string): Promise<HouseMeter | undefined>;
  saveHouseReading(reading: Reading): Promise<Reading>;
  /** История общедомовых приборов, свежие первыми. */
  listHouseReadingsFor(meterIds: readonly string[]): Promise<Reading[]>;
  /** Убрать показание узла учёта: им исправляют опечатку за этот месяц. */
  deleteHouseReading(readingId: string): Promise<void>;

  saveInspection(inspection: Inspection): Promise<Inspection>;
  findInspection(id: string): Promise<Inspection | undefined>;
  /** Осмотры дома: незаконченные и история, по которой считается срок следующего. */
  listInspections(buildingId: string): Promise<Inspection[]>;

  /** Попытка привязки к квартире: по ним ловится перебор кодов. */
  saveBindAttempt(attempt: BindAttempt): Promise<void>;
  countBindAttempts(residentId: string, since: Date): Promise<number>;

  /** Просьба подключить дом: её оставляет человек, чей дом продукт ещё не знает. */
  saveConnectionRequest(request: ConnectionRequest): Promise<ConnectionRequest>;
  listConnectionRequests(limit?: number): Promise<ConnectionRequest[]>;
  /** Сколько просьб оставил этот человек: одна и та же не повторяется. */
  findConnectionRequest(residentId: string): Promise<ConnectionRequest | undefined>;

  saveHandoff(handoff: Handoff): Promise<Handoff>;
  findHandoff(handoffId: string): Promise<Handoff | undefined>;
  /** Переданные обращения: по заявке либо по дому целиком. */
  listHandoffs(filter: HandoffFilter): Promise<Handoff[]>;

  saveVisit(visit: Visit): Promise<Visit>;
  findVisit(visitId: string): Promise<Visit | undefined>;
  /** Записи на приём: смене по дому, жильцу свои. */
  listVisits(filter: VisitFilter): Promise<Visit[]>;

  saveSupportTicket(ticket: SupportTicket): Promise<SupportTicket>;
  findSupportTicket(ticketId: string): Promise<SupportTicket | undefined>;
  /** Обращения в поддержку: дома целиком или одного жильца. */
  listSupportTickets(filter: SupportFilter): Promise<SupportTicket[]>;

  saveTariff(record: TariffRecord): Promise<void>;
  /** Тарифы дома со всей историей: квитанция за июнь считается по июньским. */
  listTariffs(buildingId: string): Promise<TariffRecord[]>;

  /** Готовые машинные переводы: один и тот же текст переводится один раз. */
  listTranslations(fingerprints: readonly string[], language: Language): Promise<StoredTranslation[]>;
  /** Записать переводы пачкой. Запись без перевода означает, что служба не ответила. */
  saveTranslations(records: readonly StoredTranslation[]): Promise<void>;

  saveAudit(entry: AuditEntry): Promise<void>;
  /** Журнал действий по дому, свежие первыми. */
  listAudit(buildingId: string, page: { limit: number; before?: Date }): Promise<AuditEntry[]>;
}

export interface BindAttempt {
  residentId: string;
  at: Date;
  /** Код подошёл. */
  ok: boolean;
}

/**
 * Просьба подключить дом. Человек, чью управляющую организацию продукт ещё
 * не знает, до сих пор упирался в тупик: без кода из квитанции ему нечего было
 * делать. Теперь он оставляет адрес, и это единственная работающая дверь
 * к новому дому.
 */
export interface ConnectionRequest {
  id: string;
  residentId: string;
  /** Адрес дома словами человека. */
  address: string;
  /** Название управляющей организации, если человек его знает. */
  company?: string;
  /** Как с ним связаться: телефон он оставляет сам. */
  phone?: string;
  at: Date;
}

/** Что тарифицируется: ресурс по счётчику или содержание за квадратный метр. */
export type TariffKind = MeterKind | 'maintenance' | 'key_rate';

/** Тариф дома с даты начала действия. */
export interface TariffRecord {
  buildingId: string;
  kind: TariffKind;
  /** Рубли за единицу ресурса или за квадратный метр. */
  value: number;
  since: Date;
}

/** Действие сотрудника в журнале. */
export interface AuditEntry {
  id: string;
  at: Date;
  actorId: string;
  actorName: string;
  action: AuditAction;
  buildingId: string;
  subject?: string;
  details?: string;
}

