/** Что мини-приложение получает от сервера. */

import type { Language } from '@domovoy/i18n';

export interface AttachmentView {
  kind: 'photo' | 'voice' | 'file';
  /** Ссылка на файл платформы либо `file:<id>` для того, что прислали из мини-приложения и что лежит у нас. */
  token: string;
  transcript?: string;
}

/** Уточняющий вопрос об адресе заявки: вопрос и готовые варианты кнопками. */
export interface ClarifyView {
  question?: string;
  options?: { label: string; startParam: string }[];
  /** Адресом может стать любая квартира дома: заявку завела смена. */
  anyApartment?: boolean;
}

/** Документы продукта: те же тексты, что на сайте. */
export interface LegalView {
  version: string;
  documents: LegalDocumentView[];
}

/**
 * Разбор длинного документа: разделы и подписи вокруг них. Есть он не у всякого
 * текста: выгрузка своих данных и протокол собрания приходят одной строкой.
 */
export interface DocumentStructure {
  parts?: { heading: string; lines: string[] }[];
  /** Подпись редакции и, у перевода, оговорка о языке. */
  updated?: string;
  prevails?: string;
}

/**
 * Документ продукта. Текст приходит и разделами, и сплошной строкой: разделы
 * читают с экрана, строку кладут в буфер обмена целиком.
 */
export interface LegalDocumentView extends DocumentStructure {
  slug: string;
  title: string;
  short: string;
  about: string;
  text: string;
}

/**
 * Разбор документа отдельно от его текста. Пустые поля не переносятся: экран
 * различает «раздела нет» и «раздел пустой».
 */
export const structureOf = (document: LegalDocumentView): DocumentStructure => ({
  ...(document.parts && document.parts.length > 0 ? { parts: document.parts } : {}),
  ...(document.updated ? { updated: document.updated } : {}),
  ...(document.prevails ? { prevails: document.prevails } : {}),
});

/** Ответ помощника: что делать и куда идти. */
export interface AssistantView {
  answer: string;
  /** Вопрос не о доме и не о продукте. */
  offTopic?: boolean;
  /** Раздел приложения, если переход нужен. */
  screen?: string;
  /** Название раздела: им подписана кнопка перехода. */
  title?: string;
  /** Та же возможность командой бота. */
  command?: string;
  /** Язык вопроса, если он не тот, что выбран: на него предлагается перейти. */
  offerLanguage?: Language;
  /** Подпись кнопки перехода на этот язык, на нём же. */
  offerTitle?: string;
  /** Ответ собрала модель или подобрали ключевые слова. */
  by: 'model' | 'keywords';
}

/** Переданное смежной организации обращение. */
export interface HandoffView {
  id: string;
  requestId: string;
  to: string;
  organization: string;
  channel: string;
  status: string;
  statusTitle: string;
  dueAt: string;
  /** Чем установлен срок ответа: норма, а не решение продукта. */
  basis: string;
  overdue: boolean;
  createdAt: string;
  externalId?: string;
  answer?: string;
  answeredAt?: string;
}

/** Кто отвечает за заявку и кому её можно передать. */
export interface ResponsibilityView {
  kind: string;
  title: string;
  basis: string;
  next?: string;
  organization?: string;
  /** Кому смена может передать обращение. Жильцу список не приходит. */
  targets?: { to: string; organization: string; basis: string }[];
  handoffs?: HandoffView[];
}

/** Текст, как его написал человек, и язык, на котором он написан. */
export interface OriginalTextView {
  text: string;
  language: string;
}

export interface RequestView {
  id: string;
  number: string;
  category: string;
  /** Название категории словами. Приходит с сервера: таблица настраивается под УК. */
  categoryTitle: string;
  /** Одно слово для кнопки отбора. */
  categoryShort?: string;
  priority: string;
  status: string;
  /** Состояние словами того, кто смотрит: те же, что в выгрузке «Мои данные». */
  statusTitle?: string;
  /** Короткая суть в одну строку, её показывают в списках. */
  title: string;
  description: string;
  /** Суть и описание переведены машинно: рядом с ними идёт пометка. */
  machineTranslated?: boolean;
  /** Как написал жилец, если писал не по-русски: смена читает перевод и оригинал. */
  original?: OriginalTextView;
  target: string;
  createdAt: string;
  reactionDueAt: string;
  resolutionDueAt: string;
  /** Срок, который сейчас на кону: до приёма реакции, дальше выполнения. */
  dueAt: string;
  overdue: boolean;
  reactionOverdue: boolean;
  /** Чем установлен срок: регламент организации, а не решение продукта. */
  deadlineBasis?: string;
  /** Что мастер обязан предъявить, когда работает в квартире. */
  workerNote?: string;
  /**
   * Работы идут в квартире и есть кому ехать: только тогда время визита
   * и согласуется. Общее имущество открывают без жильца.
   */
  needsVisit?: boolean;
  /** Согласование визита в квартиру: окна на выбор, выбранное и неудачные выезды. */
  appointment?: { slots: string[]; at?: string; missed: number };
  /** Что израсходовано на работы. */
  materials?: { title: string; count: number; unit?: string }[];
  /** Чем объяснён отказ: в истории это строка без подписи. */
  rejectionReason?: string;
  /** Отказ ещё можно вернуть на пересмотр. */
  disputable?: boolean;
  /** Отказ уже оспаривали: второй раз заявку на пересмотр не вернуть. */
  disputedAt?: string;
  /** Когда работу закроют без ответа жильца. Есть только у сданной работы. */
  autoConfirmAt?: string;
  /** Сколько жильцов сообщили об одном и том же. */
  reporters: number;
  /** Об этом сообщили независимо несколько человек: отказ общего имущества. */
  incident: boolean;
  /** `shared`: причина в общем имуществе. `local`: искать надо в квартире. */
  spread?: { affected: number; fine: number; verdict: 'unknown' | 'shared' | 'local' };
  /** Что сделать до приезда мастера: только у открытой аварийной заявки. */
  hint?: string;
  /** Смотрящий уже сообщал об этом. Приходит только в паспорте объекта. */
  mine?: boolean;
  /** Есть кому постучать сверху: квартира выше существует и её жилец в приложении. */
  canKnock?: boolean;
  /** Соседу сверху уже постучали. */
  knocked?: boolean;
  /** Карта опроса по квартирам. Приходит только сотруднику. */
  survey?: { number: number; state: 'affected' | 'fine' | 'silent' }[];
  reopenCount: number;
  /** Кто ведёт работу. Пусто, пока заявку никому не поручили. */
  assigneeId?: string;
  assigneeName?: string;
  /** Оценка работы жильцом, 1…5. Её может не быть. */
  rating?: number;
  attachments: AttachmentView[];
  /** Прогноз срыва срока. Приходит только в очереди сотрудника. */
  risk?: 'none' | 'watch' | 'high';
  riskReason?: string;
  history: HistoryEventView[];
}

export interface HistoryEventView {
  at: string;
  status: string;
  role: string;
  /** Кто из жильцов написал. Приходит только там, где заявку подали несколько соседей. */
  speaker?: 'you' | 'neighbour';
  /** Сообщение в переписке: состояние оно не меняет. */
  kind?: 'message';
  comment?: string;
  /** Исходный текст реплики, если она написана не по-русски. */
  original?: OriginalTextView;
  /** Снимок, приложенный к этому переходу: чаще всего результат работы мастера. */
  attachments?: AttachmentView[];
  /** Мастер отсканировал наклейку объекта: он был на месте. */
  onSite?: boolean;
}

export interface PlannedWorkView {
  title: string;
  category: string;
  until: string;
  /** Готовый ответ жильцу: срок в первой строке, название работ во второй. */
  message: string;
}

export interface SubmitResult {
  /** Обращение присоединено к уже открытой заявке. */
  joined: boolean;
  /** Заявки нет, если обращение объяснилось плановыми работами. */
  request?: RequestView;
  /** Идут объявленные работы по этой части дома. */
  planned?: PlannedWorkView;
  /** Чего не хватило в обращении: один вопрос. Заявка заведена и без ответа. */
  question?: string;
  /** Написанное оказалось вопросом: продукт ответил и заявку не завёл. */
  answered?: string;
}

export interface ChargesView {
  period: string;
  lines: { title: string; amount: number; detail?: string }[];
  total: number;
  paid: number;
  dueDay: number;
  /** Долг за прошлые месяцы. */
  debt?: number;
  /** Пени за просрочку: считаются по ключевой ставке. */
  penalty?: number;
  /** За какие месяцы идёт долг, словами. */
  debtFor?: string;
  /** Чем посчитаны норматив и пени: пункты правил. */
  bases?: string[];
}

export interface DeviceView {
  id: string;
  kind: 'intercom' | 'barrier' | 'camera';
  title: string;
  entrance?: number;
}

export interface DoorEventView {
  deviceId: string;
  at: string;
  action: 'opened' | 'snapshot' | 'guest-code';
  by: 'resident' | 'guest';
  /** Кто это сделал. Пусто, если человек с тех пор перестал быть жильцом дома. */
  who?: string;
}

export interface TariffView {
  kind: string;
  title: string;
  unit: string;
  value: number;
  /** Тариф задан управляющей организацией. */
  own: boolean;
  since?: string;
  /** Откуда значение: умолчание продукта или данные организации. */
  basis?: string;
}

export interface NoticeView {
  kind: string;
  title: string;
  /** Уведомление включено. */
  on: boolean;
}

export interface ImportResultView {
  added: number;
  updated: number;
  meters: number;
  problems: { line: number; message: string }[];
}

export interface AuditEntryView {
  id: string;
  at: string;
  actorName: string;
  action: string;
  actionTitle: string;
  subject?: string;
  details?: string;
}

export interface ObjectPassportView {
  startParam: string;
  target: string;
  open: RequestView[];
  history: RequestView[];
  totalRequests: number;
  /** Оборудование этого подъезда: домофон, шлагбаум, камера. */
  devices?: DeviceView[];
  lastRepairAt?: string;
  /** Как часто объект ломается и когда ждать следующего раза. */
  averageDays?: number;
  dueInDays?: number;
}

export interface ComplaintOffer {
  possible: boolean;
  reason: string;
  complaint?: string;
  /** Обращение уже отправлено: номер и срок ответа. */
  sent?: { externalId?: string; dueAt: string; organization: string };
}

/** Чем кончилась отправка обращения в надзор. */
export interface ComplaintSent {
  organization: string;
  externalId?: string;
  dueAt: string;
  /** Канал модельный: настоящего обмена за ним нет. */
  model?: boolean;
}

/** Окна визита мастера: предложенные и выбранное. */
export interface VisitOfferView {
  requestId: string;
  slots: string[];
  at?: string;
}

/** Наряд в дне исполнителя. */
export interface WorkdayItemView {
  requestId: string;
  number: string;
  title: string;
  place: string;
  entrance?: number;
  status: string;
  priority?: string;
  visitAt?: string;
  dueAt: string;
  overdue: boolean;
  materials?: { title: string; count: number; unit?: string }[];
}

export interface WorkdayView {
  items: WorkdayItemView[];
  appointed: number;
  overdue: number;
}

/** Кто ещё привязан к квартире. */
export interface FlatNeighbourView {
  id: string;
  displayName: string;
  owner: boolean;
  self: boolean;
}

/** Просьба подключить дом, которого в продукте ещё нет. */
export interface ConnectionView {
  address?: string;
  company?: string;
  at?: string;
}

export type VoteChoiceView = 'for' | 'against' | 'abstain';

export interface PollView {
  id: string;
  kind: 'simple' | 'qualified';
  kindTitle: string;
  title: string;
  question: string;
  /** Название и вопрос переведены машинно. */
  machineTranslated?: boolean;
  opensAt: string;
  closesAt: string;
  open: boolean;
  /** Доля площади проголосовавших, 0…1. */
  turnout: number;
  quorum: boolean;
  passed: boolean;
  totalArea: number;
  votedArea: number;
  /** Сколько площади не хватает до кворума. */
  areaToQuorum: number;
  /** Порог кворума долей: отметка, до которой должна дойти полоса участия. */
  quorumShare?: number;
  shares: Record<VoteChoiceView, number>;
  /** Доля «за» по правилу этого вопроса. */
  support: number;
  myChoice?: VoteChoiceView;
  /** Голос за квартиру подал другой её житель: его имя. */
  votedBy?: string;
  /** Собрание собственников или опрос жильцов. */
  mode?: 'meeting' | 'survey';
  /** Номер сообщения о собрании в системе. */
  noticeId?: string;
  /** Номер протокола в системе. */
  protocolId?: string;
  /** Чем установлен порог: правило этого вопроса словами. */
  basis?: string;
  /** Когда подведены итоги: с этого момента есть протокол. */
  closedAt?: string;
}

export interface InitiativeView {
  id: string;
  kind: 'simple' | 'qualified';
  kindTitle: string;
  title: string;
  question: string;
  /** Название и вопрос переведены машинно. */
  machineTranslated?: boolean;
  createdAt: string;
  /** Сколько помещений подписалось. */
  signatures: number;
  /** Доля площади подписавшихся, 0…1. */
  share: number;
  /** Доля, с которой собственники вправе требовать собрания. */
  demandShare?: number;
  /** Сколько площади не хватает до этого права. */
  areaToDemand?: number;
  enough: boolean;
  /** Чем установлена доля: статья Жилищного кодекса. */
  basis?: string;
  /** Квартира спрашивающего уже подписана. */
  mine?: boolean;
  /** Предложение завёл спрашивающий. */
  author?: boolean;
  /** Собрание, созванное по этой инициативе. */
  pollId?: string;
}

export interface MeterView {
  id: string;
  kind: string;
  title: string;
  unit: string;
  decimals: number;
  serial: string;
  submittedThisMonth: boolean;
  lastConsumption: number;
  lastValue?: number;
  lastAt?: string;
  verifiedUntil?: string;
  /** Поверка: после срока показания недостоверны и платят по нормативу. */
  verification: 'ok' | 'soon' | 'expired';
}

export interface PaymentView {
  period: string;
  /** Месяц словами, с годом. */
  periodTitle: string;
  amount: number;
  at: string;
}

export interface DebtorView {
  residentId: string;
  displayName: string;
  apartmentNumber?: number;
  /** Долг по начислениям, без пеней. */
  debt: number;
  penalty: number;
  /** За какие месяцы идёт долг, словами. */
  months?: string;
  overdueDays: number;
}

export interface HouseDebtView {
  total: number;
  penalty: number;
  debtors: DebtorView[];
}

export interface ReadingPeriodView {
  at: string;
  value: number;
  /** Расход с прошлого показания. */
  consumption: number;
}

export interface ReadingResultView {
  value: number;
  at: string;
  consumption: number;
  /** Расход резко выше обычного. */
  spike: boolean;
  /** Что сказать о расходе, если он необычный. */
  advice?: string;
}

export interface UnboundResidentView {
  id: string;
  displayName: string;
}

export type RoleView = 'resident' | 'dispatcher' | 'technician' | 'manager' | 'contractor';

export interface PersonView {
  id: string;
  displayName: string;
  role: RoleView;
  /** Квартира человека в этом доме, если она у него есть. */
  apartmentId?: string;
  apartmentNumber?: number;
  /** Сотрудник на дежурстве: ночные заявки уходят ему. */
  onDuty?: boolean;
  /** Дома, которые обслуживает сотрудник. */
  buildingIds?: string[];
}

export interface ApartmentOptionView {
  id: string;
  number: number;
  entrance: number;
  riser: number;
  /** Код из квитанции: сотрудник называет его жильцу. */
  code?: string;
}

export interface ApartmentView {
  id: string;
  number: number;
  buildingId: string;
  address: string;
  /** Квартира, с которой человек работает сейчас. */
  current: boolean;
}

export interface StaffMemberView {
  id: string;
  displayName: string;
  role: string;
  /** Сколько незакрытых заявок сейчас на человеке. */
  load: number;
}

export interface PeriodSummaryView {
  from: string;
  to: string;
  created: number;
  closed: number;
  confirmed: number;
  rejected: number;
  mergedReports: number;
  /** Доля закрытых в срок, 0…1. */
  inTimeRate: number;
  averageHours: number;
  missed: number;
  /** Сколько закрытых заявок жильцы оценили. */
  rated: number;
  /** Средняя оценка, 1…5. Ноль означает «не оценивали». */
  averageRating: number;
}

/** Событие в доме на ближайшие дни. */
export interface HouseEventView {
  kind: 'works' | 'poll' | 'inspection';
  at: string;
  title: string;
  /** Название переведено машинно. */
  machineTranslated?: boolean;
  where: string;
}

/** Работа управляющей организации за месяц в том виде, в каком её видит жилец. */
export interface QualityView {
  buildingId: string;
  /** Адрес дома: у сотрудника это его собственный дом, а не дом смены. */
  address?: string;
  /** Длина промежутка в днях: ею и подписаны числа. */
  days?: number;
  from: string;
  to: string;
  open: number;
  overdue: number;
  created: number;
  closed: number;
  rated: number;
  inTimeRate?: number;
  averageHours?: number;
  averageRating?: number;
  /** Такой же промежуток перед этим: с ним и сравнивают. */
  before?: { closed: number; inTimeRate?: number; averageHours?: number };
}

export interface ReportView {
  buildingId: string;
  summary: {
    total: number;
    open: number;
    overdue: number;
    confirmed: number;
    rejected: number;
    /** Сколько обращений сэкономила склейка. */
    mergedReports: number;
  };
  /** Работа за выбранный период. */
  period: PeriodSummaryView;
  /** Такой же промежуток перед ним: с ним и сравнивают. */
  previous: PeriodSummaryView;
  categories: { category: string; title: string; total: number; overdue: number; overdueRate: number }[];
  assignees: {
    assigneeId: string;
    displayName: string;
    completed: number;
    reopened: number;
    reopenRate: number;
    /** Сколько сдач подтверждено сканом наклейки у объекта. */
    onSite: number;
    rated: number;
    averageRating: number;
  }[];
  objects: { title: string; requests: number; reopened: number }[];
  incidents: { requestId: string; number: string; title: string; target: string; reporters: number }[];
  /** Осмотры общего имущества за период. */
  inspections?: { finished: number; overdue: number; found: number };
  /** Заявки по суткам периода: пульс дома. */
  daily?: number[];
  /** Пересказ сводки словами. Приходит, только если подключена модель. */
  digest?: string;
  /** Чем собран пересказ: это разбор текста, а не расчёт продукта. */
  digestBasis?: string;
  /** Переданные смежным организациям обращения, по которым ждут ответ. */
  handoffs?: HandoffView[];
}

export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  /** Название и текст переведены машинно: рядом с ними идёт пометка. */
  machineTranslated?: boolean;
  createdAt: string;
  /** Кого касается: «весь дом», «подъезд 2», «подъезд 2, стояк 1». */
  audience: string;
  recipients: number;
  /** Объявление о плановых работах: что не работает и до какого момента. */
  works?: { category: string; from: string; until: string };
}

/** Датчик и когда он последний раз выходил на связь. */
export interface SensorView {
  id: string;
  kind: string;
  title: string;
  silent: boolean;
  lastSeenAt?: string;
}

/** Выданный гостю код: пока он не сработал и не истёк, его можно отозвать. */
export interface GuestCodeView {
  code: string;
  deviceId: string;
  expiresAt: string;
}

/** Осмотр общего имущества по чек-листу. */
export interface InspectionView {
  id: string;
  kind: string;
  title: string;
  entrance?: number;
  /** Оборудование, если это его плановое обслуживание. */
  equipmentTitle?: string;
  dueAt: string;
  overdue: boolean;
  finishedAt?: string;
  /** Мастер отсканировал наклейку объекта: обход был на месте. */
  onSite?: boolean;
  /** Сколько пунктов уже отмечено. */
  checked: number;
  requestIds: string[];
  items: { title: string; state?: 'ok' | 'problem'; comment?: string; at?: string }[];
}

/** Строка дома в списке компании. */
export interface BuildingLineView {
  buildingId: string;
  code: string;
  address: string;
  open: number;
  overdue: number;
  created: number;
  inTimeRate?: number;
  averageRating?: number;
  /** Дом, в котором сотрудник работает сейчас. */
  current?: boolean;
}

export interface PlanAlertView {
  id: string;
  title: string;
  emergency: boolean;
}

/** План дома с обстановкой: подъезды, стояки и что с каждой квартирой. */
export interface HousePlanView {
  entrances: {
    entrance: number;
    risers: {
      riser: number;
      flats: { number: number; state: 'emergency' | 'open' | 'fine' | 'quiet'; requestId?: string }[];
      /** Заявки на весь стояк: он и подсвечен целиком. */
      alerts: PlanAlertView[];
    }[];
    /** Заявки на весь подъезд. */
    alerts: PlanAlertView[];
  }[];
  /** Заявки по дому целиком и по оборудованию. */
  house: PlanAlertView[];
}

/** Здоровье оборудования по его истории поломок. */
export interface EquipmentHealthView {
  code: string;
  /** Код объекта: по нему открывается его карточка, как по наклейке. */
  startParam: string;
  title: string;
  failures: number;
  lastAt?: string;
  averageDays?: number;
  dueInDays?: number;
  broken: boolean;
}

/** Что в доме прямо сейчас: аварии, которые касаются человека, и идущие работы. */
export interface HouseNowView {
  /** Состояние дома целиком. */
  mood: 'sleeping' | 'walking' | 'alarmed';
  incidents: {
    id: string;
    title: string;
    /** Название переведено машинно. */
    machineTranslated?: boolean;
    target: string;
    status: string;
    resolutionDueAt: string;
    reporters: number;
  }[];
  works: { title: string; machineTranslated?: boolean; audience: string; until: string }[];
}

export interface Profile {
  id: string;
  displayName: string;
  role: RoleView;
  apartmentId: string | null;
  /** Язык человека. Пусто: язык ещё не выбран. */
  language?: Language | null;
  /** Согласие с документами: до него продукт показывает их. */
  legal?: { version: string; accepted: boolean };
  /** Квартира и адрес словами: их показывает профиль. */
  apartmentNumber?: number;
  address?: string;
  /** Телефон, если человек им поделился. */
  phone?: string;
  /** Сотрудник на дежурстве: ночные заявки идут ему. */
  onDuty?: boolean;
  /** Полномочия старшего по подъезду, если соседи их дали. */
  elder?: { entrance: number; until: string };
  /** Окно подачи показаний, числами месяца. */
  readingWindow?: { fromDay: number; toDay: number };
  /** Есть ли чем прочитать показание с фотографии табло. */
  meterPhoto?: boolean;
  /** Есть ли чем расшифровать запись: без этого кнопку записи не показывают. */
  voice?: boolean;
  /** Подключён ли платёжный шлюз: без него оплату не предлагают. */
  payments?: boolean;
  /** Подключены ли домофон и датчики. */
  doors?: boolean;
  /** Режим проверки: доступно переключение роли. */
  demo?: boolean;
  /** Управляющая организация ведёт приём по записи. */
  reception?: boolean;
  /** Файлы уходят в переписку: наклейки и выгрузки. */
  files?: boolean;
  /** Что в этой установке работает на модельном подключении: `doors`, `payments`, `handoff`. */
  model?: string[];
}

/** Роль, которую проверяющий примеряет на себя. */
export interface DemoRoleView {
  role: string;
  title: string;
  about: string;
  current: boolean;
}

/** Реплика в переписке с управляющей организацией. */
export interface TicketMessageView {
  at: string;
  /** Кто написал: жилец или смена. */
  from: 'resident' | 'staff';
  /** Написал тот, кто смотрит. */
  own?: boolean;
  authorName?: string;
  text: string;
  /** Как написал жилец, если писал не по-русски. */
  original?: OriginalTextView;
  attachments?: AttachmentView[];
}

/** Обращение в поддержку и вся переписка по нему. */
export interface TicketView {
  id: string;
  subject: string;
  status: 'open' | 'answered' | 'closed';
  statusTitle: string;
  buildingId: string;
  createdAt: string;
  updatedAt: string;
  /** Обращение завёл тот, кто смотрит. */
  mine?: boolean;
  /** Кто спросил: смене нужно имя и квартира, а не только текст вопроса. */
  authorName?: string;
  apartment?: number;
  /** С какого момента вопрос ждёт ответа. У отвеченных и закрытых пусто. */
  waitingSince?: string;
  /** До какого момента положено ответить: десять рабочих дней. */
  answerDueAt?: string;
  /** Чем установлен срок ответа: пункт правил управления. */
  basis?: string;
  /** Срок ответа нарушен. */
  overdue?: boolean;
  messages: TicketMessageView[];
}

/** Ответственный по дому от управляющей организации. */
export interface HouseContactView {
  name: string;
  /** Должность: «старший инженер». */
  role?: string;
  phone?: string;
  email?: string;
}

/** Запись на приём в управляющую организацию. */
export interface VisitView {
  id: string;
  at: string;
  minutes: number;
  topic: string;
  status: 'booked' | 'cancelled' | 'done';
  /** День словами: «22 сентября». */
  day: string;
  /** Часы и минуты: «15:00». */
  clock: string;
  /** Кто записался. Приходит смене. */
  residentName?: string;
  apartment?: number;
}

/** Свободные часы приёма и своя запись. */
/** Приёмное окно: день недели и часы. */
export interface ReceptionWindowView {
  /** День недели от понедельника: 1, воскресенье, 7. */
  weekday: number;
  /** Начало окна, «15:00». */
  from: string;
  to: string;
}

export interface ReceptionView {
  buildingId: string;
  minutes: number;
  /** Приёмные окна словами: «вторник 15:00-19:00». */
  hours: string;
  /** Те же окна полями: из них смена и правит заданное. */
  windows?: ReceptionWindowView[];
  /** Адрес приёма из карточки дома. */
  office?: string;
  slots: { at: string; day: string; clock: string }[];
  mine?: VisitView;
}

/** Сведения об обслуживании дома: их держит в MAX управляющая организация. */
export interface HouseServiceView {
  /** Телефон аварийно-диспетчерской службы, круглосуточный. */
  emergencyPhone?: string;
  phone?: string;
  email?: string;
  /** Режим работы организации. */
  hours?: string;
  /** Адрес центра обслуживания. */
  office?: string;
  officeHours?: string;
}

/** К кому обращаться по дому. */
export interface HouseContactsView {
  buildingId: string;
  address: string;
  managementCompany?: string;
  contact?: HouseContactView;
  /** Телефоны, режим работы и адрес приёма. */
  service?: HouseServiceView;
  /** Кто на дежурстве прямо сейчас. */
  duty?: { displayName: string; phone?: string };
}

/** Стиль наклейки: название и цвета для образца. */
export interface StickerStyleView {
  name: string;
  title: string;
  paper: string;
  ink: string;
  accent: string;
}

/** Объект дома, на который делают наклейку. */
export interface StickerObjectView {
  payload: string;
  caption: string;
  link: string;
  /** Что это: подъезд, стояк, оборудование или квартира. */
  kind: 'entrance' | 'riser' | 'equipment' | 'apartment' | 'building';
  target: string;
}

export interface StickersView {
  styles: StickerStyleView[];
  objects: StickerObjectView[];
}

/** Отправленная наклейка: по идентификатору сообщения её пересылают дальше. */
export interface SentStickerView {
  caption: string;
  payload: string;
  link: string;
  /** Чем ушла наклейка: картинкой в ленту или файлом для печати. */
  as: 'image' | 'document';
  messageId?: string;
}

/** Отправленный лист для печати. */
export interface StickerSheetView {
  count: number;
  address?: string;
  messageId?: string;
}

export interface BuildingView {
  id: string;
  code: string;
  address: string;
  /** Дом, с которым человек работает по умолчанию. */
  current?: boolean;
  timeZone?: string;
  managementCompany?: string;
  /** К дому привязан общий чат жильцов. */
  chatBound?: boolean;
  /** Ответственный по дому. */
  contact?: HouseContactView;
  /** Телефоны, режим работы и адрес приёма. */
  service?: HouseServiceView;
}

export interface ContextView {
  target: string;
  audience: string | null;
  buildingId: string | null;
}

/** Кому уходит рассылка: адресат приходит на сервер плоским телом. */
export interface BroadcastScopeView {
  kind: 'building' | 'entrance' | 'riser' | 'apartments' | 'debtors' | 'meters' | 'poll' | 'staff';
  entrance?: number;
  riser?: number;
  numbers?: number[];
  pollId?: string;
}

/** Из чего управляющая организация собирает адресат рассылки. */
export interface BroadcastTargetsView {
  entrances: { entrance: number; flats: number; risers: { riser: number; flats: number }[] }[];
  flats: number;
  polls: { id: string; title: string }[];
  staff: number;
}

/** Охват выбранного адресата. */
export interface BroadcastAimView {
  audience: string;
  /** Сколько человек под него подходит. */
  people: number;
  /** Из них получат сообщение. */
  recipients: number;
  apartments: number;
}

export interface BroadcastResultView extends BroadcastAimView {
  sent: number;
}

/** Капитальный ремонт дома по региональной программе. */
export interface CapitalRepairView {
  source?: string;
  /** Подключение модельное: настоящего обмена за ним нет. */
  model?: boolean;
  fund?: 'regional' | 'own';
  contribution?: number;
  balance?: number;
  operator?: string;
  works: { title: string; year: number; state: string; note?: string }[];
}
