import {
  DomainError,
  createRequest,
  hasReported,
  isCompanyStaff,
  type Apartment,
  type CreateRequestInput,
  type Eldership,
  type Handoff,
  type HouseMeter,
  type Initiative,
  type Inspection,
  type Meter,
  type Poll,
  type Reading,
  type RequestEvent,
  type ServiceRequest,
  type SupportTicket,
  type Visit,
  type Vote,
} from '@domovoy/domain';

import { apartmentsOf } from './apartments.js';
import type {
  Announcement,
  AuditEntry,
  BindAttempt,
  Building,
  Equipment,
  HandoffFilter,
  Repository,
  RequestFilter,
  Resident,
  StoredFile,
  SupportFilter,
  TariffRecord,
  VisitFilter,
} from './repository.js';

/**
 * Показание за тот же момент по тому же прибору одно: в базе это ключ, здесь
 * прежняя запись убирается перед новой. Иначе расход считался бы по любой из двух.
 */
const replacing = (kept: Map<string, Reading>, reading: Reading): void => {
  for (const [id, known] of kept) {
    if (id !== reading.id && known.meterId === reading.meterId && known.at.getTime() === reading.at.getTime()) {
      kept.delete(id);
    }
  }
};

/**
 * Одно и то же событие заявки, доставленное повторно: те же время, состояние,
 * автор, вид и текст. Без текста два сообщения одного автора в одну секунду
 * склеивались в одно; база различает их по тем же полям.
 */
const sameEvent = (one: RequestEvent, other: RequestEvent): boolean =>
  one.at.getTime() === other.at.getTime() &&
  one.status === other.status &&
  one.actorId === other.actorId &&
  one.kind === other.kind &&
  (one.comment ?? '') === (other.comment ?? '');

/** История двух копий заявки: события обеих, по времени и без повторов. */
const merged = (known: readonly RequestEvent[], saved: readonly RequestEvent[]): RequestEvent[] => {
  const all = [...known];

  for (const event of saved) {
    if (!all.some((kept) => sameEvent(kept, event))) all.push(event);
  }

  return all.sort((one, other) => one.at.getTime() - other.at.getTime());
};

export class InMemoryRepository implements Repository {
  private readonly residents = new Map<string, Resident>();
  private readonly apartments = new Map<string, Apartment>();
  private readonly requests = new Map<string, ServiceRequest>();
  /** Выданные номера заявок по дому и месяцу: номер не повторяется. */
  private readonly sequences = new Map<string, number>();
  private readonly announcements = new Map<string, Announcement>();
  private readonly meters = new Map<string, Meter>();
  private readonly polls = new Map<string, Poll>();
  private readonly votes = new Map<string, Vote>();
  private readonly initiatives = new Map<string, Initiative>();
  private readonly elderships: Eldership[] = [];
  private readonly readings = new Map<string, Reading>();
  private readonly houseMeters = new Map<string, HouseMeter>();
  private readonly houseReadings = new Map<string, Reading>();
  private readonly inspections = new Map<string, Inspection>();
  private readonly buildings = new Map<string, Building>();
  private readonly equipment = new Map<string, Equipment>();
  private readonly files = new Map<string, StoredFile>();
  private readonly audit: AuditEntry[] = [];
  private readonly tariffs: TariffRecord[] = [];
  private readonly bindAttempts: BindAttempt[] = [];
  private readonly tickets = new Map<string, SupportTicket>();
  private readonly visits = new Map<string, Visit>();
  private readonly handoffs = new Map<string, Handoff>();

  constructor(
    seed: {
      buildings?: (Omit<Building, 'address'> & { address?: string })[];
      apartments?: Apartment[];
      residents?: Resident[];
      equipment?: Equipment[];
    } = {},
  ) {
    for (const building of seed.buildings ?? []) {
      this.buildings.set(building.id, { ...building, address: building.address ?? '' });
    }
    for (const apartment of seed.apartments ?? []) this.apartments.set(apartment.id, apartment);
    for (const resident of seed.residents ?? []) this.residents.set(resident.id, resident);
    for (const item of seed.equipment ?? []) this.equipment.set(`${item.buildingId}:${item.code}`, item);
  }

  async findResidentByMaxUserId(maxUserId: number): Promise<Resident | undefined> {
    return [...this.residents.values()].find((resident) => resident.maxUserId === maxUserId);
  }

  async findResident(id: string): Promise<Resident | undefined> {
    return this.residents.get(id);
  }

  async listResidentsByApartments(apartmentIds: readonly string[]): Promise<Resident[]> {
    const wanted = new Set(apartmentIds);

    return [...this.residents.values()].filter((resident) =>
      apartmentsOf(resident).some((apartmentId) => wanted.has(apartmentId)),
    );
  }

  async listStaff(buildingId: string): Promise<Resident[]> {
    return [...this.residents.values()].filter(
      (resident) =>
        isCompanyStaff(resident.role) &&
        (resident.buildingId === buildingId || (resident.servesBuildingIds ?? []).includes(buildingId)),
    );
  }

  async listManagers(): Promise<Resident[]> {
    return [...this.residents.values()].filter((resident) => resident.role === 'manager');
  }

  async listUnboundResidents(): Promise<Resident[]> {
    return [...this.residents.values()].filter(
      (resident) => resident.role === 'resident' && apartmentsOf(resident).length === 0,
    );
  }

  async listResidents(buildingId: string): Promise<Resident[]> {
    const here = new Set(
      [...this.apartments.values()]
        .filter((apartment) => apartment.buildingId === buildingId)
        .map((apartment) => apartment.id),
    );

    return [...this.residents.values()].filter(
      (resident) =>
        resident.buildingId === buildingId || apartmentsOf(resident).some((apartmentId) => here.has(apartmentId)),
    );
  }

  async saveResident(resident: Resident): Promise<Resident> {
    this.residents.set(resident.id, resident);
    return resident;
  }

  async saveBuilding(building: Building): Promise<void> {
    this.buildings.set(building.id, building);
  }

  async saveApartment(apartment: Apartment): Promise<void> {
    this.apartments.set(apartment.id, apartment);
  }

  async listApartments(buildingId: string): Promise<Apartment[]> {
    return [...this.apartments.values()].filter((apartment) => apartment.buildingId === buildingId);
  }

  async findApartment(apartmentId: string): Promise<Apartment | undefined> {
    return this.apartments.get(apartmentId);
  }

  async findApartmentByCode(code: string): Promise<Apartment | undefined> {
    return [...this.apartments.values()].find((apartment) => apartment.code === code);
  }

  async saveFile(file: StoredFile): Promise<void> {
    this.files.set(file.id, file);
  }

  async findFile(id: string): Promise<StoredFile | undefined> {
    return this.files.get(id);
  }

  async saveEquipment(equipment: Equipment): Promise<void> {
    this.equipment.set(`${equipment.buildingId}:${equipment.code}`, equipment);
  }

  async listEquipment(buildingId: string): Promise<Equipment[]> {
    return [...this.equipment.values()].filter((item) => item.buildingId === buildingId);
  }

  async findEquipment(buildingId: string, code: string): Promise<Equipment | undefined> {
    return this.equipment.get(`${buildingId}:${code}`);
  }

  /**
   * Счётчик номеров, а не пересчёт заявок: два обращения, поданные разом, до
   * записи первого видели одну и ту же длину списка и получали один номер.
   */
  async nextRequestSequence(buildingId: string, at: Date): Promise<number> {
    const period = `${at.getUTCFullYear()}-${at.getUTCMonth()}`;
    const key = `${buildingId}:${period}`;

    const taken =
      this.sequences.get(key) ??
      [...this.requests.values()].filter(
        (request) =>
          request.buildingId === buildingId &&
          request.createdAt.getUTCFullYear() === at.getUTCFullYear() &&
          request.createdAt.getUTCMonth() === at.getUTCMonth(),
      ).length;

    const next = taken + 1;

    this.sequences.set(key, next);

    return next;
  }

  async buildingCode(buildingId: string): Promise<string | undefined> {
    return this.buildings.get(buildingId)?.code;
  }

  async findBuilding(buildingId: string): Promise<Building | undefined> {
    return this.buildings.get(buildingId);
  }

  async listBuildings(): Promise<Building[]> {
    return [...this.buildings.values()];
  }

  async createRequest(input: CreateRequestInput): Promise<ServiceRequest> {
    const request = createRequest(input);
    this.requests.set(request.id, request);
    return request;
  }

  /**
   * История сливается, а не заменяется: сохранивший заявку по копии, прочитанной
   * раньше, иначе стирал бы событие другой стороны. Состояние берётся из
   * последнего перехода слитой истории, как это делает база.
   */
  async saveRequest(request: ServiceRequest): Promise<ServiceRequest> {
    const known = this.requests.get(request.id);
    const history = known ? merged(known.history, request.history) : request.history;
    const settled = [...history].reverse().find((event) => event.kind !== 'message');

    const saved: ServiceRequest = {
      ...request,
      history,
      ...(settled ? { status: settled.status } : {}),
    };

    this.requests.set(saved.id, saved);

    return saved;
  }

  async findRequest(id: string): Promise<ServiceRequest | undefined> {
    return this.requests.get(id);
  }

  async listRequests(filter: RequestFilter): Promise<ServiceRequest[]> {
    const found = [...this.requests.values()].filter((request) => {
      if (filter.buildingId && request.buildingId !== filter.buildingId) return false;
      if (filter.authorId && request.authorId !== filter.authorId) return false;
      if (filter.reporterId && !hasReported(request, filter.reporterId)) return false;
      if (filter.assigneeId && request.assigneeId !== filter.assigneeId) return false;
      if (filter.statuses && !filter.statuses.includes(request.status)) return false;
      if (filter.createdAfter && request.createdAt.getTime() <= filter.createdAfter.getTime()) return false;
      if (filter.createdBefore && request.createdAt.getTime() >= filter.createdBefore.getTime()) return false;
      return true;
    });

    if (filter.limit === undefined) return found;

    return found
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, filter.limit);
  }

  async saveAnnouncement(announcement: Announcement): Promise<Announcement> {
    this.announcements.set(announcement.id, announcement);
    return announcement;
  }

  async listAnnouncements(buildingId: string): Promise<Announcement[]> {
    return [...this.announcements.values()].filter((announcement) => announcement.buildingId === buildingId);
  }

  async listWorksBetween(buildingId: string, from: Date, to: Date): Promise<Announcement[]> {
    return [...this.announcements.values()].filter(
      (announcement) =>
        announcement.buildingId === buildingId &&
        announcement.works !== undefined &&
        announcement.works.from.getTime() <= to.getTime() &&
        announcement.works.until.getTime() > from.getTime(),
    );
  }

  async savePoll(poll: Poll): Promise<Poll> {
    this.polls.set(poll.id, poll);
    return poll;
  }

  async findPoll(pollId: string): Promise<Poll | undefined> {
    return this.polls.get(pollId);
  }

  async listPolls(buildingId: string): Promise<Poll[]> {
    return [...this.polls.values()]
      .filter((poll) => poll.buildingId === buildingId)
      .sort((left, right) => right.closesAt.getTime() - left.closesAt.getTime());
  }

  async saveVote(vote: Vote): Promise<Vote> {
    this.votes.set(`${vote.pollId}:${vote.apartmentId}`, vote);
    return vote;
  }

  async listVotes(pollId: string): Promise<Vote[]> {
    return [...this.votes.values()].filter((vote) => vote.pollId === pollId);
  }

  async saveEldership(eldership: Eldership): Promise<Eldership> {
    const same = this.elderships.findIndex(
      (item) => item.buildingId === eldership.buildingId && item.entrance === eldership.entrance,
    );

    if (same >= 0) this.elderships.splice(same, 1);

    this.elderships.push(eldership);

    return eldership;
  }

  async listElderships(buildingId: string): Promise<Eldership[]> {
    return this.elderships.filter((item) => item.buildingId === buildingId);
  }

  async saveInitiative(initiative: Initiative): Promise<Initiative> {
    this.initiatives.set(initiative.id, initiative);
    return initiative;
  }

  async findInitiative(id: string): Promise<Initiative | undefined> {
    return this.initiatives.get(id);
  }

  async listInitiatives(buildingId: string): Promise<Initiative[]> {
    return [...this.initiatives.values()]
      .filter((initiative) => initiative.buildingId === buildingId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async saveMeter(meter: Meter): Promise<Meter> {
    this.meters.set(meter.id, meter);
    return meter;
  }

  async listMeters(apartmentId: string): Promise<Meter[]> {
    return [...this.meters.values()].filter((meter) => meter.apartmentId === apartmentId);
  }

  async listMetersByApartments(apartmentIds: readonly string[]): Promise<Meter[]> {
    const wanted = new Set(apartmentIds);

    return [...this.meters.values()].filter((meter) => wanted.has(meter.apartmentId));
  }

  async findMeter(meterId: string): Promise<Meter | undefined> {
    return this.meters.get(meterId);
  }

  async saveReading(reading: Reading): Promise<Reading> {
    replacing(this.readings, reading);
    this.readings.set(reading.id, reading);

    return reading;
  }

  async listReadings(meterId: string): Promise<Reading[]> {
    return this.listReadingsFor([meterId]);
  }

  async listReadingsFor(meterIds: readonly string[]): Promise<Reading[]> {
    const wanted = new Set(meterIds);

    return [...this.readings.values()]
      .filter((reading) => wanted.has(reading.meterId))
      .sort((left, right) => right.at.getTime() - left.at.getTime());
  }

  async deleteReading(readingId: string): Promise<void> {
    this.readings.delete(readingId);
  }

  async saveHouseMeter(meter: HouseMeter): Promise<HouseMeter> {
    // Прибор учёта на дом один на ресурс: база держит это ключом, память тоже.
    for (const [id, known] of this.houseMeters) {
      if (id !== meter.id && known.buildingId === meter.buildingId && known.kind === meter.kind) {
        this.houseMeters.delete(id);
      }
    }

    this.houseMeters.set(meter.id, meter);

    return meter;
  }

  async listHouseMeters(buildingId: string): Promise<HouseMeter[]> {
    return [...this.houseMeters.values()].filter((meter) => meter.buildingId === buildingId);
  }

  async findHouseMeter(meterId: string): Promise<HouseMeter | undefined> {
    return this.houseMeters.get(meterId);
  }

  async saveHouseReading(reading: Reading): Promise<Reading> {
    replacing(this.houseReadings, reading);
    this.houseReadings.set(reading.id, reading);

    return reading;
  }

  async listHouseReadingsFor(meterIds: readonly string[]): Promise<Reading[]> {
    const wanted = new Set(meterIds);

    return [...this.houseReadings.values()]
      .filter((reading) => wanted.has(reading.meterId))
      .sort((left, right) => right.at.getTime() - left.at.getTime());
  }

  async deleteHouseReading(readingId: string): Promise<void> {
    this.houseReadings.delete(readingId);
  }

  async saveInspection(inspection: Inspection): Promise<Inspection> {
    this.inspections.set(inspection.id, inspection);
    return inspection;
  }

  async findInspection(id: string): Promise<Inspection | undefined> {
    return this.inspections.get(id);
  }

  async listInspections(buildingId: string): Promise<Inspection[]> {
    return [...this.inspections.values()].filter((inspection) => inspection.buildingId === buildingId);
  }

  async saveBindAttempt(attempt: BindAttempt): Promise<void> {
    this.bindAttempts.push(attempt);
  }

  async countBindAttempts(residentId: string, since: Date): Promise<number> {
    return this.bindAttempts.filter(
      (attempt) => attempt.residentId === residentId && !attempt.ok && attempt.at.getTime() >= since.getTime(),
    ).length;
  }

  async saveHandoff(handoff: Handoff): Promise<Handoff> {
    this.handoffs.set(handoff.id, handoff);
    return handoff;
  }

  async findHandoff(handoffId: string): Promise<Handoff | undefined> {
    return this.handoffs.get(handoffId);
  }

  async listHandoffs(filter: HandoffFilter): Promise<Handoff[]> {
    return [...this.handoffs.values()]
      .filter((handoff) => {
        if (filter.requestId && handoff.requestId !== filter.requestId) return false;
        if (filter.buildingId && handoff.buildingId !== filter.buildingId) return false;
        if (filter.waiting && (handoff.status === 'answered' || handoff.status === 'failed')) return false;

        return true;
      })
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async saveVisit(visit: Visit): Promise<Visit> {
    // Уникальный индекс занятого времени, как в базе (миграция 047):
    // отменённые и состоявшиеся записи время не держат.
    const taken =
      visit.status === 'booked' &&
      [...this.visits.values()].some(
        (other) =>
          other.id !== visit.id &&
          other.status === 'booked' &&
          other.buildingId === visit.buildingId &&
          other.at.getTime() === visit.at.getTime(),
      );

    if (taken) throw new DomainError('slot_taken', 'Это время уже занято');

    this.visits.set(visit.id, visit);
    return visit;
  }

  async findVisit(visitId: string): Promise<Visit | undefined> {
    return this.visits.get(visitId);
  }

  async listVisits(filter: VisitFilter): Promise<Visit[]> {
    return [...this.visits.values()]
      .filter((visit) => {
        if (filter.buildingId && visit.buildingId !== filter.buildingId) return false;
        if (filter.residentId && visit.residentId !== filter.residentId) return false;
        if (filter.statuses && !filter.statuses.includes(visit.status)) return false;
        if (filter.from && visit.at.getTime() < filter.from.getTime()) return false;

        return true;
      })
      .sort((left, right) => left.at.getTime() - right.at.getTime());
  }

  async saveSupportTicket(ticket: SupportTicket): Promise<SupportTicket> {
    this.tickets.set(ticket.id, ticket);
    return ticket;
  }

  async findSupportTicket(ticketId: string): Promise<SupportTicket | undefined> {
    return this.tickets.get(ticketId);
  }

  async listSupportTickets(filter: SupportFilter): Promise<SupportTicket[]> {
    return [...this.tickets.values()].filter((ticket) => {
      if (filter.buildingId && ticket.buildingId !== filter.buildingId) return false;
      if (filter.residentId && ticket.residentId !== filter.residentId) return false;
      if (filter.statuses && !filter.statuses.includes(ticket.status)) return false;

      return true;
    });
  }

  async saveTariff(record: TariffRecord): Promise<void> {
    const same = (item: TariffRecord): boolean =>
      item.buildingId === record.buildingId &&
      item.kind === record.kind &&
      item.since.getTime() === record.since.getTime();

    const index = this.tariffs.findIndex(same);

    if (index >= 0) this.tariffs[index] = record;
    else this.tariffs.push(record);
  }

  async listTariffs(buildingId: string): Promise<TariffRecord[]> {
    return this.tariffs.filter((record) => record.buildingId === buildingId);
  }

  async saveAudit(entry: AuditEntry): Promise<void> {
    this.audit.push(entry);
  }

  async listAudit(buildingId: string, page: { limit: number; before?: Date }): Promise<AuditEntry[]> {
    return this.audit
      .filter((entry) => entry.buildingId === buildingId)
      .filter((entry) => (page.before ? entry.at.getTime() < page.before.getTime() : true))
      .sort((left, right) => right.at.getTime() - left.at.getTime())
      .slice(0, page.limit);
  }
}
