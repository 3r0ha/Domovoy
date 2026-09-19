import type {
  AnnouncementView,
  ApartmentOptionView,
  BroadcastAimView,
  BroadcastResultView,
  BroadcastScopeView,
  BroadcastTargetsView,
  ApartmentView,
  AttachmentView,
  AuditEntryView,
  BuildingLineView,
  BuildingView,
  ChargesView,
  AssistantView,
  ClarifyView,
  LegalView,
  CapitalRepairView,
  ComplaintOffer,
  ComplaintSent,
  HandoffView,
  ResponsibilityView,
  ContextView,
  DemoRoleView,
  DeviceView,
  DoorEventView,
  EquipmentHealthView,
  GuestCodeView,
  HouseContactsView,
  HouseContactView,
  HouseServiceView,
  HouseDebtView,
  HouseEventView,
  HouseNowView,
  HousePlanView,
  ImportResultView,
  InitiativeView,
  InspectionView,
  MeterView,
  NoticeView,
  ObjectPassportView,
  PaymentView,
  PersonView,
  PollView,
  Profile,
  QualityView,
  ReceptionView,
  ReceptionWindowView,
  ReadingPeriodView,
  ReadingResultView,
  ReportView,
  RequestView,
  RoleView,
  SensorView,
  SentStickerView,
  StaffMemberView,
  StickersView,
  StickerSheetView,
  SubmitResult,
  TariffView,
  TicketView,
  UnboundResidentView,
  VisitView,
  VoteChoiceView,
} from './views.js';

export type * from './views.js';
export * from './format.js';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** Сессия кончилась: приложению нужно войти заново. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Причина неудачи словами. */
export const describeFailure = (error: unknown): string => {
  if (error instanceof ApiError) return error.message;

  return 'Нет связи с сервером';
};

/** Отказ из-за непривязанной квартиры: помогает не повтор, а привязка по коду. */
export const needsApartment = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'apartment_not_bound';

/** Есть ли смысл повторять. */
export const worthRetrying = (error: unknown): boolean => {
  if (!(error instanceof ApiError)) return true;

  return error.status >= 500 || error.status === 408 || error.status === 429;
};

/** Где приложение держит последний ответ сервера. */
export interface ResponseCache {
  get(key: string): string | null;
  set(key: string, value: string): void;
  clear(): void;
}

/** Хранилище браузера, если оно есть. Внутри клиента MAX его может не быть. */
export const browserCache = (): ResponseCache => {
  const memory = new Map<string, string>();
  const store = ((): Storage | null => {
    try {
      const probe = globalThis.localStorage;

      probe.setItem('domovoy:probe', '1');
      probe.removeItem('domovoy:probe');

      return probe;
    } catch {
      return null;
    }
  })();

  return {
    // Память нужна и при живом хранилище: переполненное оно ничего не приняло.
    get: (key) => store?.getItem(key) ?? memory.get(key) ?? null,
    set: (key, value) => {
      try {
        if (store) store.setItem(key, value);
        else memory.set(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    clear: () => {
      memory.clear();

      if (!store) return;

      for (const key of Object.keys(store)) {
        if (key.startsWith(CACHE_PREFIX)) store.removeItem(key);
      }
    },
  };
};

const CACHE_PREFIX = 'domovoy:cache:';

/** Когда запас последний раз пополнялся: этим подписан режим «нет связи». */
const SAVED_AT_KEY = `${CACHE_PREFIX}@saved-at`;

export interface ApiOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  /** Куда складывать последние ответы. Без него приложение работает без запаса. */
  cache?: ResponseCache;
  /** Показан ли сохранённый ответ вместо свежего. */
  onOffline?: (offline: boolean) => void;
}

/** Клиент прикладного API. */
/** Что выдаёт сервер в обмен на строку запуска. */
export interface SessionView {
  token: string;
  expiresAt: number;
  displayName: string;
}

/** Сколько ждёт запрос, прежде чем считаться неотвеченным. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Общее чтение по адресу: ответ делится, сеть бросается, когда ушли все. */
interface SharedRead {
  path: string;
  promise: Promise<unknown>;
  stop: AbortController;
  /** Сколько экранов ждут ответа. */
  waiting: number;
}

/** Запрос бросили, а не потеряли: связь тут ни при чём. */
const wasDropped = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';

/** Что общее у всех ссылок на клиент: сессия, выбранный дом и текущие чтения. */
interface SharedState {
  token: string | null;
  buildingId: string | null;
  /** Незавершённый обмен строки запуска: второй вызов ждёт его. */
  entering: Promise<SessionView> | undefined;
  /** Незавершённые чтения по адресам: одновременные запросы делят один ответ. */
  reading: Map<string, SharedRead>;
}

export class DomovoyApi {
  private readonly shared: SharedState;
  private readonly options: ApiOptions;
  private readonly baseUrl: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly cache: ResponseCache | undefined;
  private readonly onOffline: ((offline: boolean) => void) | undefined;
  /** Пока экран на месте. Уход экрана бросает его запросы. */
  private readonly alive: AbortSignal | undefined;

  constructor(options: ApiOptions, shared?: SharedState, alive?: AbortSignal) {
    this.options = options;
    this.baseUrl = options.baseUrl;
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.cache = options.cache;
    this.onOffline = options.onOffline;
    this.alive = alive;
    this.shared = shared ?? { token: null, buildingId: null, entering: undefined, reading: new Map() };
  }

  /**
   * Тот же клиент новой ссылкой. Экраны держат клиент в зависимостях запроса,
   * поэтому смена ссылки перечитывает данные, не перемонтируя экран.
   */
  reread(): DomovoyApi {
    return new DomovoyApi(this.options, this.shared);
  }

  /**
   * Тот же клиент, привязанный к жизни экрана: `useBridgeRequest` даёт сигнал,
   * и запрос ушедшего экрана бросается, не занимая слабую связь.
   */
  until(alive: AbortSignal): DomovoyApi {
    return new DomovoyApi(this.options, this.shared, alive);
  }

  useToken(token: string | null): void {
    const before = this.shared.token;

    // Холодный запуск подставляет сохранённый токен в пустое место: это не смена
    // человека, и запас ответов остаётся. Иначе «нет связи» пуст при каждом входе.
    if (before !== null && token !== before) this.cache?.clear();

    this.shared.token = token;
  }

  /** На какой момент собран запас ответов. Пусто, если свежего ответа ещё не было. */
  savedAt(): string | null {
    const stamp = Number(this.cache?.get(SAVED_AT_KEY) ?? '');

    return Number.isFinite(stamp) && stamp > 0 ? new Date(stamp).toISOString() : null;
  }

  /** С каким домом работает сотрудник. */
  useBuilding(buildingId: string | null): void {
    this.shared.buildingId = buildingId;
  }

  /** Дома, доступные человеку: сотруднику все дома компании, жильцу его собственный. */
  buildings(): Promise<BuildingView[]> {
    return this.read<BuildingView[]>('/api/buildings');
  }

  /** Дом, с которым сотрудник работает сейчас. */
  async selectedBuilding(): Promise<BuildingView | undefined> {
    const all = await this.buildings();

    return all.find((item) => (this.shared.buildingId ? item.id === this.shared.buildingId : item.current));
  }

  /** Обменивает параметры запуска на сессию. */
  login(initData: string): Promise<SessionView> {
    this.shared.entering ??= this.send<SessionView>('/auth/session', {
      method: 'POST',
      headers: { 'x-max-init-data': initData },
    })
      .then((result) => {
        this.shared.token = result.token;
        return result;
      })
      .finally(() => {
        this.shared.entering = undefined;
      });

    return this.shared.entering;
  }

  me(): Promise<Profile> {
    return this.read<Profile>('/api/me');
  }

  context(startParam: string): Promise<ContextView> {
    return this.read<ContextView>(`/api/context/${encodeURIComponent(startParam)}`);
  }

  listRequests(scope: 'mine' | 'queue' | 'closed' = 'mine', before?: string): Promise<RequestView[]> {
    const query = before ? `&before=${encodeURIComponent(before)}` : '';

    return this.read<RequestView[]>(this.at(`/api/requests?scope=${scope}${query}`));
  }

  getRequest(id: string): Promise<RequestView> {
    return this.read<RequestView>(`/api/requests/${encodeURIComponent(id)}`);
  }

  actions(id: string): Promise<{ actions: string[] }> {
    return this.read<{ actions: string[] }>(`/api/requests/${encodeURIComponent(id)}/actions`);
  }

  /** Обращение жильца. */
  createRequest(input: {
    description: string;
    startParam?: string;
    category?: string;
    attachments?: AttachmentView[];
    /** От чьей квартиры заявка: смена заводит её по телефонному звонку. */
    apartmentId?: string;
    /** Квартира не названа: заявка о доме, а не о квартире того, кто её завёл. */
    house?: boolean;
    /** Завести заявку, даже если идут объявленные работы. */
    anyway?: boolean;
  }): Promise<SubmitResult> {
    return this.send<SubmitResult>('/api/requests', { method: 'POST', body: JSON.stringify(input) });
  }

  /** Сколько квартир дома уже передали показания. Вне окна подачи пусто. */
  readingProgress(): Promise<{ total?: number; submitted?: number }> {
    return this.read<{ total?: number; submitted?: number }>('/api/meters/progress');
  }

  /** Паспорт объекта с наклейки: что с ним уже происходило. */
  objectPassport(startParam: string): Promise<ObjectPassportView> {
    return this.read<ObjectPassportView>(`/api/objects/${encodeURIComponent(startParam)}`);
  }

  /** Капитальный ремонт дома: сведения региональной программы. */
  capitalRepair(): Promise<CapitalRepairView> {
    return this.read<CapitalRepairView>(this.at('/api/capital-repair'));
  }

  complaint(id: string): Promise<ComplaintOffer> {
    return this.read<ComplaintOffer>(`/api/requests/${encodeURIComponent(id)}/complaint`);
  }

  /** Отправка обращения в надзор: только после согласия человека. */
  sendComplaint(id: string): Promise<ComplaintSent> {
    return this.send<ComplaintSent>(`/api/requests/${encodeURIComponent(id)}/complaint`, { method: 'POST' });
  }

  /** Уточняющий вопрос об адресе заявки и готовые варианты. */
  clarify(id: string): Promise<ClarifyView> {
    return this.read<ClarifyView>(`/api/requests/${encodeURIComponent(id)}/clarify`);
  }

  /** Ответ на уточняющий вопрос: адрес заявки становится точным. */
  setTarget(id: string, startParam: string): Promise<RequestView> {
    return this.send<RequestView>(`/api/requests/${encodeURIComponent(id)}/target`, {
      method: 'POST',
      body: JSON.stringify({ startParam }),
    });
  }

  /** Документы продукта: политика обработки данных и пользовательское соглашение. */
  legal(): Promise<LegalView> {
    return this.read<LegalView>('/api/legal');
  }

  /** Согласие с действующей редакцией документов. */
  acceptLegal(): Promise<{ version: string; accepted: boolean }> {
    return this.send<{ version: string; accepted: boolean }>('/api/me/legal', { method: 'POST' });
  }

  /** С чего начать разговор с помощником: подсказки зависят от роли. */
  assistantStarters(): Promise<{ starters: string[] }> {
    return this.read<{ starters: string[] }>('/api/assistant');
  }

  /** Помощник: короткий ответ и готовый переход в нужный раздел. */
  assistant(question: string, history: readonly { asked: string; said: string }[] = []): Promise<AssistantView> {
    return this.send<AssistantView>('/api/assistant', {
      method: 'POST',
      body: JSON.stringify(history.length > 0 ? { question, history } : { question }),
    });
  }

  /** Кто отвечает за заявку, кому её можно передать и что уже передано. */
  responsibility(id: string): Promise<ResponsibilityView> {
    return this.read<ResponsibilityView>(`/api/requests/${encodeURIComponent(id)}/responsibility`);
  }

  /** Передача обращения смежной организации: доступна смене. */
  passRequest(id: string, to: string): Promise<HandoffView> {
    return this.send<HandoffView>(`/api/requests/${encodeURIComponent(id)}/handoff`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    });
  }

  /** Ответ смежной организации записывает смена. */
  answerHandoff(id: string, answer: string): Promise<HandoffView> {
    return this.send<HandoffView>(`/api/handoffs/${encodeURIComponent(id)}/answer`, {
      method: 'POST',
      body: JSON.stringify({ status: 'answered', answer }),
    });
  }

  /** Сводка по дому за последние `days` суток. Доступна только сотрудникам. */
  report(days?: number): Promise<ReportView> {
    return this.send<ReportView>(this.at(days === undefined ? '/api/report' : `/api/report?days=${days}`));
  }

  /** Пересказ сводки словами: приходит отдельно, числа его не ждут. */
  reportDigest(days?: number): Promise<{ digest?: string; basis?: string }> {
    const path = days === undefined ? '/api/report/digest' : `/api/report/digest?days=${days}`;

    return this.read<{ digest?: string; basis?: string }>(this.at(path));
  }

  /** Как работает управляющая компания в доме жильца. */
  quality(): Promise<QualityView> {
    return this.read<QualityView>(this.at('/api/quality'));
  }

  /** Что в доме будет на неделе. */
  houseAhead(): Promise<HouseEventView[]> {
    return this.read<HouseEventView[]>(this.at('/api/ahead'));
  }

  /** Заявки дома, которые касаются жильца и заведены не им. */
  houseRequests(): Promise<RequestView[]> {
    return this.read<RequestView[]>(this.at('/api/requests/house'));
  }

  /** «У меня то же самое» по заявке дома. */
  supportRequest(id: string): Promise<RequestView> {
    return this.send<RequestView>(`/api/requests/${encodeURIComponent(id)}/support`, { method: 'POST' });
  }

  /** Спросить соседа сверху: при заливе кран закрывает он. */
  knockUpstairs(id: string): Promise<RequestView> {
    return this.send<RequestView>(`/api/requests/${encodeURIComponent(id)}/knock`, { method: 'POST' });
  }

  /** Реестр заявок за период таблицей. */
  /** Показания приборов за месяц, для ГИС ЖКХ. */
  exportReadings(format: 'xlsx' | 'csv' = 'xlsx'): Promise<{ filename: string; blob: Blob }> {
    return this.download(this.at(`/api/export/readings.${format}`), `показания.${format}`, 'Не удалось выгрузить показания');
  }

  /** Реестр заявок файлом: книгой Excel или текстом с разделителями. */
  exportRequests(days: number, format: 'xlsx' | 'csv' = 'xlsx'): Promise<{ filename: string; blob: Blob }> {
    return this.download(
      this.at(`/api/report/requests.${format}?days=${days}`),
      `заявки.${format}`,
      'Не удалось выгрузить реестр',
    );
  }

  /** Кому можно поручить работу, вместе с текущей загрузкой. */
  staff(): Promise<StaffMemberView[]> {
    return this.read<StaffMemberView[]>(this.at('/api/staff'));
  }

  /** Жильцы, которых управляющая компания ещё не связала с квартирой. */
  unboundResidents(): Promise<UnboundResidentView[]> {
    return this.read<UnboundResidentView[]>(this.at('/api/residents/unbound'));
  }

  /** Отправка снимка. */
  uploadPhoto(contentType: string, data: string): Promise<AttachmentView> {
    return this.send<AttachmentView>('/api/files', {
      method: 'POST',
      body: JSON.stringify({ contentType, data }),
    });
  }

  /** Сказанное словами: запись уходит на расшифровку и возвращается текстом. */
  voice(data: string, contentType: string): Promise<{ text: string }> {
    return this.send<{ text: string }>('/api/voice', {
      method: 'POST',
      body: JSON.stringify({ data, contentType }),
    });
  }

  /** Содержимое снимка. */
  async photo(token: string): Promise<Blob> {
    const id = token.slice('file:'.length);
    const response = await this.doFetch(`${this.baseUrl}/api/files/${encodeURIComponent(id)}`, {
      headers: this.authorized(),
    });

    if (!response.ok) throw new ApiError(response.status, 'file_unavailable', 'Снимок недоступен');

    return response.blob();
  }

  /** Люди дома: жильцы и сотрудники. */
  /** Передача дома другой управляющей организации. */
  handOverBuilding(input: { company: string; managerId: string }): Promise<{
    company: string;
    managerName: string;
    released: number;
    notified: number;
    chatKept: boolean;
  }> {
    return this.send(this.at('/api/buildings/handover'), { method: 'POST', body: JSON.stringify(input) });
  }

  people(): Promise<PersonView[]> {
    return this.read<PersonView[]>(this.at('/api/residents'));
  }

  /** Назначение роли: раздаёт управляющий. */
  assignRole(residentId: string, role: RoleView): Promise<PersonView> {
    return this.send<PersonView>(`/api/residents/${encodeURIComponent(residentId)}/role`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
  }

  /** Дежурство: переключает любой сотрудник, смена меняется каждый день. */
  setDuty(residentId: string, onDuty: boolean): Promise<PersonView> {
    return this.send<PersonView>(`/api/residents/${encodeURIComponent(residentId)}/duty`, {
      method: 'POST',
      body: JSON.stringify({ onDuty }),
    });
  }

  /** Дома, которые обслуживает сотрудник: по ним ему приходят заявки. */
  setServedBuildings(residentId: string, buildingIds: string[]): Promise<PersonView> {
    return this.send<PersonView>(`/api/residents/${encodeURIComponent(residentId)}/buildings`, {
      method: 'POST',
      body: JSON.stringify({ buildingIds }),
    });
  }

  /** Жилец съехал: квартира освобождается, заявки и показания остаются у дома. */
  unbindResident(residentId: string, apartmentId?: string): Promise<{ id: string }> {
    return this.send<{ id: string }>(`/api/residents/${encodeURIComponent(residentId)}/unbind`, {
      method: 'POST',
      ...(apartmentId ? { body: JSON.stringify({ apartmentId }) } : {}),
    });
  }

  /** Квартиры дома: выбор для привязки. */
  apartments(): Promise<ApartmentOptionView[]> {
    return this.read<ApartmentOptionView[]>(this.at('/api/apartments'));
  }

  /** Привязка жильца сотрудником: код потерян или спорен. */
  bindResident(residentId: string, apartmentId: string): Promise<{ number: number; alreadyBound: boolean }> {
    return this.send(`/api/residents/${encodeURIComponent(residentId)}/apartment`, {
      method: 'POST',
      body: JSON.stringify({ apartmentId }),
    });
  }

  polls(): Promise<PollView[]> {
    return this.read<PollView[]>(this.at('/api/polls'));
  }

  startPoll(input: {
    kind: 'simple' | 'qualified';
    title: string;
    question: string;
    days: number;
    /** Собрание собственников или опрос жильцов. */
    mode?: 'meeting' | 'survey';
  }): Promise<PollView> {
    return this.send<PollView>(this.at('/api/polls'), { method: 'POST', body: JSON.stringify(input) });
  }

  /** Поставить на голосование старшего по подъезду. Подъезд берётся тот, где живёт кандидат. */
  startElderPoll(candidateId: string, days: number): Promise<PollView> {
    return this.send<PollView>(this.at('/api/polls/elder'), {
      method: 'POST',
      body: JSON.stringify({ candidateId, days }),
    });
  }

  initiatives(): Promise<InitiativeView[]> {
    return this.read<InitiativeView[]>(this.at('/api/initiatives'));
  }

  startInitiative(input: { title: string; question: string }): Promise<InitiativeView> {
    return this.send<InitiativeView>(this.at('/api/initiatives'), { method: 'POST', body: JSON.stringify(input) });
  }

  supportInitiative(id: string): Promise<InitiativeView> {
    return this.send<InitiativeView>(`/api/initiatives/${encodeURIComponent(id)}/support`, { method: 'POST' });
  }

  /** Созыв собрания по предложению жильцов: доступен управляющей компании. */
  callMeeting(id: string, days: number, kind: 'simple' | 'qualified'): Promise<PollView> {
    return this.send<PollView>(`/api/initiatives/${encodeURIComponent(id)}/meeting`, {
      method: 'POST',
      body: JSON.stringify({ days, kind }),
    });
  }

  /** Оплата долга: каждый прошлый месяц закрывается своим платежом. */
  payDebt(): Promise<{ paid: number; periods: string[] }> {
    return this.send<{ paid: number; periods: string[] }>('/api/charges/debt/pay', { method: 'POST' });
  }

  /** Телефон из `requestContact`: подпись платформы проверяет сервер. */
  saveContact(contact: { phone: string; authDate?: string; hash?: string }): Promise<{ phone: string }> {
    return this.send<{ phone: string }>('/api/me/contact', { method: 'POST', body: JSON.stringify(contact) });
  }

  forgetContact(): Promise<unknown> {
    return this.send<unknown>('/api/me/contact', { method: 'DELETE' });
  }

  /** Телефон автора заявки: при аварии мастеру нужно позвонить. */
  requestContact(requestId: string): Promise<{ displayName: string; phone?: string }> {
    return this.read<{ displayName: string; phone?: string }>(
      `/api/requests/${encodeURIComponent(requestId)}/contact`,
    );
  }

  /** Что присылать: аварии и свои заявки отключить нельзя. */
  notices(): Promise<NoticeView[]> {
    return this.read<NoticeView[]>('/api/me/notices');
  }

  setNotice(kind: string, on: boolean): Promise<NoticeView[]> {
    return this.send<NoticeView[]>('/api/me/notices', { method: 'POST', body: JSON.stringify({ kind, on }) });
  }

  /** Всё, что продукт знает о человеке. */
  async personalData(): Promise<string> {
    const { text } = await this.read<{ text: string }>('/api/me/data');

    return text;
  }

  /** Удаление профиля: связь с человеком снимается, история дома остаётся. */
  async forgetMe(): Promise<void> {
    await this.send<unknown>('/api/me', { method: 'DELETE' });
  }

  /** История показаний прибора, от старых к новым. */
  meterHistory(meterId: string): Promise<ReadingPeriodView[]> {
    return this.read<ReadingPeriodView[]>(`/api/meters/${encodeURIComponent(meterId)}/history`);
  }

  /** Протокол завершённого собрания. */
  async pollProtocol(pollId: string): Promise<string> {
    const { text } = await this.read<{ text: string }>(`/api/polls/${encodeURIComponent(pollId)}/protocol`);

    return text;
  }

  vote(pollId: string, choice: VoteChoiceView): Promise<PollView> {
    return this.send<PollView>(`/api/polls/${encodeURIComponent(pollId)}/vote`, {
      method: 'POST',
      body: JSON.stringify({ choice }),
    });
  }

  /** Привязка к квартире по коду из квитанции. */
  bindApartment(code: string): Promise<{ apartmentId: string; number: number; alreadyBound: boolean }> {
    return this.send('/api/me/apartment', { method: 'POST', body: JSON.stringify({ code }) });
  }

  /** Свои квартиры: их может быть несколько, в том числе в разных домах. */
  ownApartments(): Promise<ApartmentView[]> {
    return this.read<ApartmentView[]>('/api/me/apartments');
  }

  /** Работать с другой своей квартирой: показания и квитанция идут по ней. */
  useApartment(apartmentId: string): Promise<{ apartmentId: string; buildingId?: string }> {
    return this.send('/api/me/apartment/use', { method: 'POST', body: JSON.stringify({ apartmentId }) });
  }

  meters(): Promise<MeterView[]> {
    return this.read<MeterView[]>('/api/meters');
  }

  payments(): Promise<PaymentView[]> {
    return this.read<PaymentView[]>('/api/payments');
  }

  debtors(): Promise<HouseDebtView> {
    return this.read<HouseDebtView>(this.at('/api/debtors'));
  }

  remindDebtor(residentId: string): Promise<{ displayName: string }> {
    return this.send<{ displayName: string }>(`/api/debtors/${encodeURIComponent(residentId)}/remind`, {
      method: 'POST',
    });
  }

  houseMeters(): Promise<MeterView[]> {
    return this.read<MeterView[]>(this.at('/api/house-meters'));
  }

  addHouseMeter(kind: string, serial: string): Promise<MeterView> {
    return this.send<MeterView>(this.at('/api/house-meters'), {
      method: 'POST',
      body: JSON.stringify({ kind, serial }),
    });
  }

  submitHouseReading(meterId: string, value: number): Promise<ReadingResultView> {
    return this.send<ReadingResultView>(`/api/house-meters/${encodeURIComponent(meterId)}/readings`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    });
  }

  submitReading(meterId: string, value: number): Promise<ReadingResultView> {
    return this.send<ReadingResultView>(`/api/meters/${encodeURIComponent(meterId)}/readings`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    });
  }

  transition(
    id: string,
    to: string,
    options: {
      comment?: string;
      assigneeId?: string;
      attachments?: AttachmentView[];
      rating?: number;
      /** Код с наклейки: им мастер подтверждает, что был у объекта. */
      provedBy?: string;
    } = {},
  ): Promise<RequestView> {
    return this.send<RequestView>(`/api/requests/${encodeURIComponent(id)}/transition`, {
      method: 'POST',
      body: JSON.stringify({
        to,
        ...(options.comment ? { comment: options.comment } : {}),
        ...(options.assigneeId ? { assigneeId: options.assigneeId } : {}),
        ...(options.attachments?.length ? { attachments: options.attachments } : {}),
        ...(options.rating === undefined ? {} : { rating: options.rating }),
        ...(options.provedBy ? { provedBy: options.provedBy } : {}),
      }),
    });
  }

  /** Начисление за текущий месяц: считается из показаний самого жильца. */
  charges(): Promise<ChargesView> {
    return this.read<ChargesView>('/api/charges');
  }

  payCharges(): Promise<{ period: string; amount: number; at: string }> {
    return this.send<{ period: string; amount: number; at: string }>('/api/charges/pay', { method: 'POST' });
  }

  /** Оборудование дома, доступное этому человеку. */
  devices(): Promise<DeviceView[]> {
    return this.read<DeviceView[]>(this.at('/api/devices'));
  }

  openDevice(id: string): Promise<{ id: string; title: string }> {
    return this.send<{ id: string; title: string }>(`/api/devices/${encodeURIComponent(id)}/open`, {
      method: 'POST',
    });
  }

  deviceSnapshot(id: string): Promise<{ deviceId: string; at: string; image: string }> {
    return this.send<{ deviceId: string; at: string; image: string }>(
      `/api/devices/${encodeURIComponent(id)}/snapshot`,
    );
  }

  /** Свои обращения в поддержку, а у смены, вопросы всего дома. */
  supportTickets(): Promise<TicketView[]> {
    return this.read<TicketView[]>(this.at('/api/support'));
  }

  /** Новый вопрос или реплика в открытом обращении. */
  askSupport(text: string, ticketId?: string, attachments?: AttachmentView[]): Promise<TicketView> {
    return this.send<TicketView>(this.at('/api/support'), {
      method: 'POST',
      body: JSON.stringify({
        text,
        ...(ticketId ? { ticketId } : {}),
        ...(attachments?.length ? { attachments } : {}),
      }),
    });
  }

  /** Ответ смены жильцу. */
  answerSupport(ticketId: string, text: string, attachments?: AttachmentView[]): Promise<TicketView> {
    return this.send<TicketView>(this.at(`/api/support/${encodeURIComponent(ticketId)}/answer`), {
      method: 'POST',
      body: JSON.stringify({ text, ...(attachments?.length ? { attachments } : {}) }),
    });
  }

  /** Вопрос снят: переписка по нему закрывается. */
  closeSupport(ticketId: string): Promise<TicketView> {
    return this.send<TicketView>(`/api/support/${encodeURIComponent(ticketId)}/close`, { method: 'POST' });
  }

  /** Сколько обращений ждёт ответа именно этого человека. */
  supportWaiting(): Promise<{ waiting: number }> {
    return this.read<{ waiting: number }>(this.at('/api/support/waiting'));
  }

  /** Роли для проверки: список с отметкой текущей. */
  demoRoles(): Promise<DemoRoleView[]> {
    return this.read<DemoRoleView[]>('/api/demo');
  }

  /** Примерить роль: продукт дальше ведёт себя как для неё. */
  takeDemoRole(role: string): Promise<{ role: string }> {
    return this.send<{ role: string }>('/api/demo', { method: 'POST', body: JSON.stringify({ role }) });
  }

  /** Реестр заявок файлом в переписку с ботом. */
  sendRequestsExport(days: number): Promise<{ filename: string }> {
    return this.send<{ filename: string }>(this.at(`/api/report/requests/send?days=${days}`), { method: 'POST' });
  }

  /** Показания прошлого месяца файлом в переписку с ботом. */
  sendReadingsExport(): Promise<{ filename: string }> {
    return this.send<{ filename: string }>(this.at('/api/export/readings/send'), { method: 'POST' });
  }

  /** Свободные часы приёма и своя запись. */
  reception(): Promise<ReceptionView> {
    return this.read<ReceptionView>(this.at('/api/reception'));
  }

  /** Приёмные часы дома: их задаёт управляющий. */
  setReception(windows: ReceptionWindowView[], minutes?: number): Promise<ReceptionView> {
    return this.send<ReceptionView>(this.at('/api/reception'), {
      method: 'POST',
      body: JSON.stringify({ windows, ...(minutes === undefined ? {} : { minutes }) }),
    });
  }

  /** Пришедшего без записи заносит сотрудник. */
  recordVisit(residentId: string, topic: string, at?: string): Promise<VisitView> {
    return this.send<VisitView>(this.at('/api/visits/record'), {
      method: 'POST',
      body: JSON.stringify({ residentId, topic, ...(at ? { at } : {}) }),
    });
  }

  /** Записи на приём: смене по дому, жильцу свои. */
  visits(): Promise<VisitView[]> {
    return this.read<VisitView[]>(this.at('/api/visits'));
  }

  /** Запись на выбранный час приёма. */
  bookVisit(at: string, topic: string): Promise<VisitView> {
    return this.send<VisitView>(this.at('/api/visits'), { method: 'POST', body: JSON.stringify({ at, topic }) });
  }

  cancelVisit(visitId: string): Promise<VisitView> {
    return this.send<VisitView>(`/api/visits/${encodeURIComponent(visitId)}/cancel`, { method: 'POST' });
  }

  /** Приём состоялся: отмечает смена. */
  completeVisit(visitId: string): Promise<VisitView> {
    return this.send<VisitView>(`/api/visits/${encodeURIComponent(visitId)}/done`, { method: 'POST' });
  }

  /** К кому обращаться по дому: ответственный от компании и дежурный смены. */
  houseContacts(): Promise<HouseContactsView> {
    return this.read<HouseContactsView>(this.at('/api/house/contacts'));
  }

  /** На что можно сделать наклейку и какие стили доступны. */
  stickers(): Promise<StickersView> {
    return this.read<StickersView>(this.at('/api/stickers'));
  }

  /** Картинка наклейки: её же показывают на экране и превращают в файл. */
  stickerImage(payload: string, look: { style?: string; note?: string } = {}): Promise<string> {
    const query = new URLSearchParams({ payload });

    if (look.style) query.set('style', look.style);
    if (look.note) query.set('note', look.note);

    return this.text(this.at(`/api/stickers/image?${query.toString()}`));
  }

  /** Наклейка уходит в переписку с ботом: оттуда её пересылают и сохраняют. */
  sendSticker(input: {
    payload: string;
    style?: string;
    note?: string;
    /** Готовая картинка с экрана: с ней надпись уходит ровно в том виде, что видно. */
    image?: string;
    as?: 'image' | 'document';
  }): Promise<SentStickerView> {
    return this.send<SentStickerView>(this.at('/api/stickers/send'), {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Лист для печати: все коды дома одной страницей, файлом в переписку. */
  stickerSheet(): Promise<StickerSheetView> {
    return this.send<StickerSheetView>(this.at('/api/stickers/sheet'), { method: 'POST' });
  }

  /** Карточка дома: адрес, код для номеров заявок и часовой пояс. */
  updateBuilding(card: {
    address?: string;
    timeZone?: string;
    code?: string;
    contact?: HouseContactView;
    service?: HouseServiceView;
  }): Promise<BuildingView> {
    return this.send<BuildingView>(this.at('/api/buildings/card'), {
      method: 'POST',
      body: JSON.stringify(card),
    });
  }

  /** Ещё один дом компании: заводит управляющий, дальше он в его списке домов. */
  addBuilding(card: { code: string; address?: string; timeZone?: string }): Promise<BuildingView> {
    return this.send<BuildingView>(this.at('/api/buildings'), {
      method: 'POST',
      body: JSON.stringify(card),
    });
  }

  /** Отвязать чат дома: объявления перестают уходить в общий чат. */
  releaseHouseChat(): Promise<BuildingView> {
    return this.send<BuildingView>(this.at('/api/buildings/chat'), { method: 'DELETE' });
  }

  importEquipment(csv: string): Promise<{ added: number; problems: { line: number; message: string }[] }> {
    return this.send(this.at('/api/import/equipment'), { method: 'POST', body: JSON.stringify({ csv }) });
  }

  /** Заведение дома списком квартир из выгрузки управляющей компании. */
  importApartments(csv: string): Promise<ImportResultView> {
    return this.send<ImportResultView>(this.at('/api/import/apartments'), {
      method: 'POST',
      body: JSON.stringify({ csv }),
    });
  }

  /** Тарифы дома: по ним считается квитанция каждого помещения. */
  tariffs(): Promise<TariffView[]> {
    return this.read<TariffView[]>(this.at('/api/tariffs'));
  }

  setTariff(kind: string, value: number): Promise<TariffView[]> {
    return this.send<TariffView[]>(this.at('/api/tariffs'), {
      method: 'POST',
      body: JSON.stringify({ kind, value }),
    });
  }

  /** Журнал действий сотрудников: его смотрит управляющий. */
  audit(before?: string): Promise<AuditEntryView[]> {
    return this.read<AuditEntryView[]>(
      this.at(before ? `/api/audit?before=${encodeURIComponent(before)}` : '/api/audit'),
    );
  }

  doorJournal(before?: string): Promise<DoorEventView[]> {
    const query = before ? `?before=${encodeURIComponent(before)}` : '';

    return this.read<DoorEventView[]>(this.at(`/api/devices/journal${query}`));
  }

  inviteGuest(id: string): Promise<GuestCodeView> {
    return this.send<GuestCodeView>(`/api/devices/${encodeURIComponent(id)}/guest`, { method: 'POST' });
  }

  sensors(): Promise<SensorView[]> {
    return this.read<SensorView[]>(this.at('/api/devices/sensors'));
  }

  /** Коды, которые сейчас на руках у гостей. */
  guestCodes(): Promise<GuestCodeView[]> {
    return this.read<GuestCodeView[]>('/api/devices/guest-codes');
  }

  revokeGuestCode(code: string): Promise<void> {
    return this.send<void>(`/api/devices/guest-codes/${encodeURIComponent(code)}/revoke`, { method: 'POST' });
  }

  /** Ответить на предупреждение об аварии: то же самое у меня или всё работает. */
  answerAlert(id: string, affected: boolean): Promise<RequestView> {
    return this.send<RequestView>(`/api/requests/${encodeURIComponent(id)}/answer`, {
      method: 'POST',
      body: JSON.stringify({ affected }),
    });
  }

  /** Написать по заявке, не меняя её состояния. */
  comment(id: string, text: string, attachments: AttachmentView[] = []): Promise<RequestView> {
    return this.send<RequestView>(`/api/requests/${encodeURIComponent(id)}/comment`, {
      method: 'POST',
      body: JSON.stringify({ text, ...(attachments.length > 0 ? { attachments } : {}) }),
    });
  }

  listAnnouncements(before?: string): Promise<AnnouncementView[]> {
    return this.read<AnnouncementView[]>(
      this.at(before ? `/api/announcements?before=${encodeURIComponent(before)}` : '/api/announcements'),
    );
  }

  houseNow(): Promise<HouseNowView> {
    return this.read<HouseNowView>(this.at('/api/now'));
  }

  equipment(): Promise<EquipmentHealthView[]> {
    return this.read<EquipmentHealthView[]>(this.at('/api/equipment'));
  }

  housePlan(): Promise<HousePlanView> {
    return this.read<HousePlanView>(this.at('/api/plan'));
  }

  inspections(): Promise<InspectionView[]> {
    return this.read<InspectionView[]>(this.at('/api/inspections'));
  }

  /** Отметить пункт осмотра. Недостаток тут же становится заявкой. */
  /** Отметка о выезде на обход: код с наклейки того объекта, который осматривают. */
  proveInspection(id: string, code: string): Promise<InspectionView> {
    return this.send<InspectionView>(`/api/inspections/${encodeURIComponent(id)}/prove`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  checkInspectionItem(
    id: string,
    index: number,
    state: 'ok' | 'problem',
    comment?: string,
    attachments: AttachmentView[] = [],
  ): Promise<{ inspection: InspectionView; requestId?: string }> {
    return this.send<{ inspection: InspectionView; requestId?: string }>(
      `/api/inspections/${encodeURIComponent(id)}/items/${index}`,
      {
        method: 'POST',
        body: JSON.stringify({
          state,
          ...(comment ? { comment } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      },
    );
  }

  /** Дома компании: список общий, поэтому без выбранного дома в запросе. */
  buildingsReport(days = 30): Promise<BuildingLineView[]> {
    return this.read<BuildingLineView[]>(`/api/buildings/report?days=${days}`);
  }

  /** Показание с фотографии табло. Пусто, если не разобрали. */
  readMeterPhoto(meterId: string, token: string): Promise<{ value?: number }> {
    return this.send<{ value?: number }>(`/api/meters/${encodeURIComponent(meterId)}/photo`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  publishAnnouncement(input: {
    title: string;
    body: string;
    entrance?: number;
    riser?: number;
    /** Плановые работы: пока идут, обращения по этой части дома получают ответ сразу. */
    works?: { category: string; from: string; until: string };
  }): Promise<{
    id: string;
    audience: string;
    recipients: number;
  }> {
    return this.send(this.at('/api/announcements'), { method: 'POST', body: JSON.stringify(input) });
  }

  /** Из чего собирается адресат рассылки: подъезды, стояки и открытые собрания. */
  broadcastTargets(): Promise<BroadcastTargetsView> {
    return this.read<BroadcastTargetsView>(this.at('/api/broadcast/targets'));
  }

  /** Сколько человек получит сообщение: охват показывается до отправки. */
  previewBroadcast(scope: BroadcastScopeView): Promise<BroadcastAimView> {
    return this.send<BroadcastAimView>(this.at('/api/broadcast/preview'), {
      method: 'POST',
      body: JSON.stringify(scope),
    });
  }

  sendBroadcast(scope: BroadcastScopeView, text: string): Promise<BroadcastResultView> {
    return this.send<BroadcastResultView>(this.at('/api/broadcast'), {
      method: 'POST',
      body: JSON.stringify({ ...scope, text }),
    });
  }

  /** Тот же адрес, но в выбранном доме. */
  private at(path: string): string {
    const building = this.shared.buildingId;

    if (!building) return path;

    return `${path}${path.includes('?') ? '&' : '?'}buildingId=${encodeURIComponent(building)}`;
  }

  private authorized(): Record<string, string> {
    return this.shared.token ? { authorization: `Bearer ${this.shared.token}` } : {};
  }

  /** Выгрузка файлом: имя приходит заголовком, а его может и не быть. */
  private async download(path: string, fallback: string, failure: string): Promise<{ filename: string; blob: Blob }> {
    const response = await this.ask(path, { headers: this.authorized() });

    if (!response.ok) throw new ApiError(response.status, 'export_failed', failure);

    const disposition = response.headers.get('content-disposition') ?? '';
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];

    return { filename: encoded ? decodeURIComponent(encoded) : fallback, blob: await response.blob() };
  }

  /** Чтение с разделением одновременных запросов. */
  private read<T>(path: string): Promise<T> {
    const running = this.shared.reading.get(path) ?? this.begin<T>(path);

    return this.share<T>(running);
  }

  /** Новое чтение по адресу: своя отмена, чтобы ждущие могли его бросить. */
  private begin<T>(path: string): SharedRead {
    const stop = new AbortController();

    const started: SharedRead = {
      path,
      stop,
      waiting: 0,
      promise: this.fresh<T>(path, stop.signal).finally(() => this.forget(started)),
    };

    this.shared.reading.set(path, started);

    return started;
  }

  /** Убрать чтение из общих, если на его месте не успело появиться следующее. */
  private forget(running: SharedRead): void {
    if (this.shared.reading.get(running.path) === running) this.shared.reading.delete(running.path);
  }

  /**
   * Присоединиться к общему чтению. Сеть бросается, только когда ушли все
   * ждущие: ответ по одному адресу читают сразу несколько частей экрана.
   */
  private share<T>(running: SharedRead): Promise<T> {
    running.waiting += 1;

    const alive = this.alive;

    if (!alive) return running.promise as Promise<T>;

    const leave = (): void => {
      running.waiting -= 1;

      if (running.waiting > 0) return;

      /*
       * Запись снимается сразу, а не когда обещание отклонится. Строгий режим
       * React монтирует экран дважды подряд: второй монтаж успевает подписаться
       * раньше отклонения и получил бы это же, уже оборванное чтение.
       */
      this.forget(running);
      running.stop.abort(alive.reason);
    };

    if (alive.aborted) {
      leave();

      return running.promise as Promise<T>;
    }

    alive.addEventListener('abort', leave, { once: true });

    return (running.promise as Promise<T>).finally(() => alive.removeEventListener('abort', leave));
  }

  /** Чтение с запасом на случай пропавшей связи. */
  private async fresh<T>(path: string, alive: AbortSignal): Promise<T> {
    try {
      const data = await this.send<T>(path, {}, alive);

      this.cache?.set(`${CACHE_PREFIX}${path}`, JSON.stringify(data));
      this.cache?.set(SAVED_AT_KEY, String(Date.now()));
      this.onOffline?.(false);

      return data;
    } catch (error) {
      // Экран ушёл сам: это не обрыв связи, ни запас, ни метка «нет связи» тут ни при чём.
      if (alive.aborted || wasDropped(error)) throw error;

      // Прокси отвечает за сервер своей ошибкой: 502 и 504 значат ровно то же,
      // что оборванное соединение, и сохранённый ответ полезнее «что-то пошло не так».
      if (error instanceof ApiError && !worthRetrying(error)) throw error;

      const saved = this.cache?.get(`${CACHE_PREFIX}${path}`);

      if (saved === null || saved === undefined) throw error;

      this.onOffline?.(true);

      return JSON.parse(saved) as T;
    }
  }

  /** Ответ, который не разбирается как JSON: картинка наклейки приходит разметкой. */
  private async text(path: string): Promise<string> {
    const response = await this.ask(path, { headers: this.authorized() });
    const body = await response.text();

    if (!response.ok) throw failureOf(response.status, parsed(body));

    return body;
  }

  private async send<T>(path: string, init: RequestInit = {}, alive?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...this.authorized(),
    };

    const response = await this.ask(path, { ...init, headers }, alive);
    const text = await response.text();
    const body = parsed(text);

    if (!response.ok) throw failureOf(response.status, body);

    // Разобрать не удалось, а ответ считается успешным: дальше по нему работать нечем.
    if (body === null) throw new ApiError(response.status, 'bad_response', 'Ответ сервера не распознан');

    return body as T;
  }

  /**
   * Запрос со сроком: без него слабая связь держит экран скелетом без конца.
   * Молчание дольше срока считается отказом, который стоит повторить.
   */
  private async ask(path: string, init: RequestInit, alive?: AbortSignal): Promise<Response> {
    const watched = alive ?? this.alive;
    const stop = new AbortController();
    const late = new ApiError(408, 'timeout', 'Сервер не ответил, связь слабая');
    const timer = setTimeout(() => stop.abort(late), REQUEST_TIMEOUT_MS);
    const drop = (): void => stop.abort(watched?.reason);

    if (watched?.aborted) drop();
    else watched?.addEventListener('abort', drop, { once: true });

    try {
      return await this.doFetch(`${this.baseUrl}${path}`, { ...init, signal: stop.signal });
    } catch (error) {
      if (stop.signal.aborted && stop.signal.reason === late) throw late;

      throw error;
    } finally {
      clearTimeout(timer);
      watched?.removeEventListener('abort', drop);
    }
  }
}

/**
 * Тело ответа. Пустое тело это пустой объект, неразобранное, null: страницу
 * ошибки шлёт и прокси, а исключение здесь считалось бы обрывом связи.
 */
const parsed = (text: string): unknown => {
  if (text.trim().length === 0) return {};

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const failureOf = (status: number, body: unknown): ApiError => {
  const details = (body ?? {}) as { error?: string; message?: string };

  return new ApiError(status, details.error ?? 'unknown', details.message ?? 'Что-то пошло не так');
};
