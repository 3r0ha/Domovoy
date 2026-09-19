import { apartmentsOf } from '@domovoy/app';
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
} from '@domovoy/app';
import {
  COMPANY_ROLES,
  createRequest,
  type Apartment,
  type Attachment,
  type CreateRequestInput,
  type Eldership,
  type Handoff,
  type HouseMeter,
  type Initiative,
  type Inspection,
  type InspectionKind,
  type Meter,
  type Poll,
  type Reading,
  type RequestEvent,
  type RequestJoin,
  type ServiceRequest,
  type SupportTicket,
  type TicketMessage,
  type Visit,
  type Vote,
} from '@domovoy/domain';

import {
  fromTarget,
  NO_ANSWERS,
  toAnnouncement,
  toApartment,
  toBuilding,
  toHandoff,
  toRequest,
  toResident,
  toVisit,
  type AnnouncementRow,
  type ApartmentRow,
  type Answers,
  type BuildingRow,
  type EventRow,
  type HandoffRow,
  type RequestRow,
  type ResidentRow,
  type VisitRow,
} from './rows.js';
import { type SqlClient } from './sql.js';

/** Сколько заявок отдаёт список, если предел не задан. */
const REQUEST_LIMIT = 1000;

/** Незаполненное поле уходит в колонку как null. */
const orNull = (value?: string | number): string | number | null => value ?? null;

/** Колонки дома по порядку запроса. */
const buildingValues = (building: Building): (string | number | null)[] => {
  const { contact, service } = building;

  return [
    building.id,
    building.code,
    building.address,
    orNull(building.managementCompany),
    orNull(building.companyId),
    orNull(building.timeZone),
    orNull(building.chatId),
    orNull(contact?.name),
    orNull(contact?.role),
    orNull(contact?.phone),
    orNull(contact?.email),
    orNull(service?.emergencyPhone),
    orNull(service?.phone),
    orNull(service?.email),
    orNull(service?.hours),
    orNull(service?.office),
    orNull(service?.officeHours),
    building.reception ? JSON.stringify(building.reception) : null,
    orNull(building.visitMinutes),
    building.partners ? JSON.stringify(building.partners) : null,
  ];
};

/** Хранилище поверх Postgres. */
export class PostgresRepository implements Repository {
  constructor(private readonly sql: SqlClient) {}

  /** Выполняет запись целиком или не выполняет вовсе. */
  private async atomically<T>(run: (sql: SqlClient) => Promise<T>): Promise<T> {
    return this.sql.transaction ? this.sql.transaction(run) : run(this.sql);
  }

  async findResidentByMaxUserId(maxUserId: number): Promise<Resident | undefined> {
    const { rows } = await this.sql.query<ResidentRow>('select * from resident where max_user_id = $1', [maxUserId]);
    return rows[0] ? toResident(rows[0]) : undefined;
  }

  async findResident(id: string): Promise<Resident | undefined> {
    const { rows } = await this.sql.query<ResidentRow>('select * from resident where id = $1', [id]);
    return rows[0] ? toResident(rows[0]) : undefined;
  }

  async listResidentsByApartments(apartmentIds: readonly string[]): Promise<Resident[]> {
    if (apartmentIds.length === 0) return [];

    const { rows } = await this.sql.query<ResidentRow>(
      'select * from resident where apartment_id = any($1) or apartment_ids && $1',
      [apartmentIds],
    );

    return rows.map(toResident);
  }

  async listStaff(buildingId: string): Promise<Resident[]> {
    const { rows } = await this.sql.query<ResidentRow>(
      `select * from resident
       where role = any($2::role[]) and ($1 = building_id or $1 = any(serves_building_ids))
       order by role, id`,
      [buildingId, [...COMPANY_ROLES]],
    );

    return rows.map(toResident);
  }

  async listManagers(): Promise<Resident[]> {
    const { rows } = await this.sql.query<ResidentRow>(
      "select * from resident where role = 'manager' order by id",
    );

    return rows.map(toResident);
  }

  async saveFile(file: StoredFile): Promise<void> {
    await this.sql.query(
      `insert into attachment_file (id, content_type, bytes, uploaded_by, building_id, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [file.id, file.contentType, Buffer.from(file.bytes), file.uploadedBy, file.buildingId, file.at],
    );
  }

  async findFile(id: string): Promise<StoredFile | undefined> {
    const { rows } = await this.sql.query<{
      id: string;
      content_type: string;
      bytes: Buffer;
      uploaded_by: string;
      building_id: string;
      created_at: Date;
    }>('select * from attachment_file where id = $1', [id]);

    const row = rows[0];

    if (!row) return undefined;

    return {
      id: row.id,
      contentType: row.content_type,
      bytes: Uint8Array.from(row.bytes),
      uploadedBy: row.uploaded_by,
      buildingId: row.building_id,
      at: row.created_at,
    };
  }

  async saveEquipment(equipment: Equipment): Promise<void> {
    await this.sql.query(
      `insert into equipment (id, building_id, code, title, kind)
       values ($1, $2, $3, $4, $5)
       on conflict (building_id, code) do update set title = excluded.title, kind = excluded.kind`,
      [
        `${equipment.buildingId}:${equipment.code}`,
        equipment.buildingId,
        equipment.code,
        equipment.title,
        equipment.kind ?? null,
      ],
    );
  }

  async listEquipment(buildingId: string): Promise<Equipment[]> {
    const { rows } = await this.sql.query<EquipmentRow>(
      'select building_id, code, title, kind from equipment where building_id = $1 order by code',
      [buildingId],
    );

    return rows.map(toEquipment);
  }

  async findEquipment(buildingId: string, code: string): Promise<Equipment | undefined> {
    const { rows } = await this.sql.query<EquipmentRow>(
      'select building_id, code, title, kind from equipment where building_id = $1 and code = $2',
      [buildingId, code],
    );

    const row = rows[0];

    return row ? toEquipment(row) : undefined;
  }

  async listUnboundResidents(): Promise<Resident[]> {
    const { rows } = await this.sql.query<ResidentRow>(
      `select * from resident
       where apartment_id is null and cardinality(apartment_ids) = 0 and role = 'resident'
       order by display_name, id`,
    );

    return rows.map(toResident);
  }

  async listResidents(buildingId: string): Promise<Resident[]> {
    const { rows } = await this.sql.query<ResidentRow>(
      `select r.* from resident r
       where r.building_id = $1
          or exists (
            select 1 from apartment a
            where a.building_id = $1 and (a.id = r.apartment_id or a.id = any(r.apartment_ids))
          )
       order by r.role, r.display_name, r.id`,
      [buildingId],
    );

    return rows.map(toResident);
  }

  /** Сохраняет жильца. */
  async saveResident(resident: Resident): Promise<Resident> {
    try {
      const { rows } = await this.sql.query<ResidentRow>(
        `insert into resident
           (id, max_user_id, display_name, role, building_id, apartment_id, apartment_ids, on_duty, forgotten_at,
            mutes, phone, serves_building_ids, legal_version, legal_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (id) do update set
           max_user_id = excluded.max_user_id,
           display_name = excluded.display_name,
           role = excluded.role,
           building_id = excluded.building_id,
           apartment_id = excluded.apartment_id,
           apartment_ids = excluded.apartment_ids,
           on_duty = excluded.on_duty,
           forgotten_at = excluded.forgotten_at,
           mutes = excluded.mutes,
           phone = excluded.phone,
           serves_building_ids = excluded.serves_building_ids,
           legal_version = excluded.legal_version,
           legal_at = excluded.legal_at
         returning *`,
        [
          resident.id,
          resident.maxUserId ?? null,
          resident.displayName,
          resident.role,
          resident.buildingId ?? null,
          resident.apartmentId ?? null,
          apartmentsOf(resident),
          resident.onDuty ?? false,
          resident.forgottenAt ?? null,
          resident.mutes ?? [],
          resident.phone ?? null,
          resident.servesBuildingIds ?? [],
          resident.legalVersion ?? null,
          resident.legalAt ?? null,
        ],
      );

      const saved = rows[0];

      return saved ? toResident(saved) : resident;
    } catch (error: unknown) {
      const duplicate = (error as { code?: string }).code === '23505';
      const existing =
        duplicate && resident.maxUserId ? await this.findResidentByMaxUserId(resident.maxUserId) : undefined;

      if (existing) return existing;

      throw error;
    }
  }

  async saveBuilding(building: Building): Promise<void> {
    await this.sql.query(
      `insert into building (
         id, code, address, management_company, company_id, time_zone, chat_id,
         contact_name, contact_role, contact_phone, contact_email,
         emergency_phone, company_phone, company_email, work_hours, office_address, office_hours,
         reception, visit_minutes, partners
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       on conflict (id) do update set
         code = excluded.code,
         address = excluded.address,
         management_company = excluded.management_company,
         company_id = excluded.company_id,
         time_zone = excluded.time_zone,
         chat_id = excluded.chat_id,
         contact_name = excluded.contact_name,
         contact_role = excluded.contact_role,
         contact_phone = excluded.contact_phone,
         contact_email = excluded.contact_email,
         emergency_phone = excluded.emergency_phone,
         company_phone = excluded.company_phone,
         company_email = excluded.company_email,
         work_hours = excluded.work_hours,
         office_address = excluded.office_address,
         office_hours = excluded.office_hours,
         reception = excluded.reception,
         visit_minutes = excluded.visit_minutes,
         partners = excluded.partners`,
      buildingValues(building),
    );
  }

  async saveApartment(apartment: Apartment): Promise<void> {
    await this.sql.query(
      `insert into apartment (id, building_id, code, number, entrance, riser, area, residents)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set
         building_id = excluded.building_id,
         code = coalesce(excluded.code, apartment.code),
         number = excluded.number,
         entrance = excluded.entrance,
         riser = excluded.riser,
         area = excluded.area,
         residents = excluded.residents`,
      [
        apartment.id,
        apartment.buildingId,
        apartment.code ?? null,
        apartment.number,
        apartment.entrance,
        apartment.riser,
        apartment.area ?? null,
        apartment.residents ?? null,
      ],
    );
  }

  async listApartments(buildingId: string): Promise<Apartment[]> {
    const { rows } = await this.sql.query<ApartmentRow>(
      'select * from apartment where building_id = $1 order by number',
      [buildingId],
    );

    return rows.map(toApartment);
  }

  async findApartment(apartmentId: string): Promise<Apartment | undefined> {
    const { rows } = await this.sql.query<ApartmentRow>('select * from apartment where id = $1', [apartmentId]);

    return rows[0] ? toApartment(rows[0]) : undefined;
  }

  async findApartmentByCode(code: string): Promise<Apartment | undefined> {
    const { rows } = await this.sql.query<ApartmentRow>('select * from apartment where code = $1', [code]);

    return rows[0] ? toApartment(rows[0]) : undefined;
  }

  /** Следующий номер заявки в доме за месяц. Без пояса месяц считается по UTC. */
  async nextRequestSequence(buildingId: string, at: Date, timeZone?: string): Promise<number> {
    const zone = timeZone ?? 'UTC';
    const period = `to_char($2::timestamptz at time zone $3::text, 'YYYY-MM')`;

    const taken = await this.sql.query<{ last_number: number }>(
      `update request_sequence set last_number = last_number + 1
       where building_id = $1 and period = ${period}
       returning last_number`,
      [buildingId, at, zone],
    );

    if (taken.rows[0]) return taken.rows[0].last_number;

    // Первая заявка месяца: счётчик заводится от уже записанных заявок.
    // Границы месяца считаются отдельно от колонки: иначе отбор не ложится на индекс.
    const { rows } = await this.sql.query<{ last_number: number }>(
      `insert into request_sequence (building_id, period, last_number)
       select $1, ${period}, count(*) + 1 from service_request
       where building_id = $1
         and created_at >= date_trunc('month', $2::timestamptz at time zone $3::text) at time zone $3::text
         and created_at < (date_trunc('month', $2::timestamptz at time zone $3::text) + interval '1 month')
                          at time zone $3::text
       on conflict (building_id, period)
         do update set last_number = request_sequence.last_number + 1
       returning last_number`,
      [buildingId, at, zone],
    );

    return rows[0]?.last_number ?? 1;
  }

  async buildingCode(buildingId: string): Promise<string | undefined> {
    const { rows } = await this.sql.query<{ code: string }>('select code from building where id = $1', [buildingId]);
    return rows[0]?.code;
  }

  async findBuilding(buildingId: string): Promise<Building | undefined> {
    const { rows } = await this.sql.query<BuildingRow>(
      'select * from building where id = $1',
      [buildingId],
    );

    const row = rows[0];

    return row ? toBuilding(row) : undefined;
  }

  async listBuildings(): Promise<Building[]> {
    const { rows } = await this.sql.query<BuildingRow>(
      'select * from building order by address, id',
    );

    return rows.map(toBuilding);
  }

  async createRequest(input: CreateRequestInput): Promise<ServiceRequest> {
    const request = createRequest(input);
    const target = fromTarget(request.target);

    await this.atomically(async (sql) => {
      await sql.query(
        `insert into service_request (
           id, number, building_id, author_id, category, priority, status, description,
           target_kind, apartment_id, apartment_number, entrance, riser, equipment_code, equipment_title,
           created_at, reaction_due_at, resolution_due_at, reopen_count, title
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          request.id,
          request.number,
          request.buildingId,
          request.authorId,
          request.category,
          request.priority,
          request.status,
          request.description,
          target.kind,
          target.apartmentId,
          target.apartmentNumber,
          target.entrance,
          target.riser,
          target.equipmentCode,
          target.equipmentTitle,
          request.createdAt,
          request.reactionDueAt,
          request.resolutionDueAt,
          request.reopenCount,
          request.title,
        ],
      );

      await appendHistory(sql, request);
      await saveAttachments(sql, request);
    });

    return request;
  }

  async saveRequest(request: ServiceRequest): Promise<ServiceRequest> {
    const target = fromTarget(request.target);

    const status = await this.atomically(async (sql) => {
      // Строка берётся под блокировку до чтения истории: диспетчер и жилец,
      // сохраняющие заявку в одну секунду, идут по очереди.
      const locked = await sql.query<{ id: string }>(
        'select id from service_request where id = $1 for update',
        [request.id],
      );

      if (locked.rows.length === 0) return request.status;

      await appendHistory(sql, request);

      // Состояние берётся из слитой истории: свой устаревший статус не затирает
      // переход, записанный второй стороной.
      const settled = await settledStatus(sql, request.id, request.status);

      await sql.query(
        `update service_request
         set status = $2, assignee_id = $3, description = $4, priority = $5, title = $16,
             resolution_due_at = $6, reopen_count = $7,
             target_kind = $8, apartment_id = $9, apartment_number = $10,
             entrance = $11, riser = $12, equipment_code = $13, equipment_title = $14,
             rating = $15, knocked_at = $17, category = $18, reaction_due_at = $19
         where id = $1`,
        [
          request.id,
          settled,
          request.assigneeId ?? null,
          request.description,
          request.priority,
          request.resolutionDueAt,
          request.reopenCount,
          target.kind,
          target.apartmentId,
          target.apartmentNumber,
          target.entrance,
          target.riser,
          target.equipmentCode,
          target.equipmentTitle,
          request.rating ?? null,
          request.title,
          request.knockedAt ?? null,
          request.category,
          request.reactionDueAt,
        ],
      );

      await saveReporters(sql, request);
      await saveAttachments(sql, request);

      return settled;
    });

    return status === request.status ? request : { ...request, status };
  }

  async findRequest(id: string): Promise<ServiceRequest | undefined> {
    const { rows } = await this.sql.query<RequestRow>('select * from service_request where id = $1', [id]);
    const row = rows[0];
    if (!row) return undefined;

    const [history, reporters, attachments] = await Promise.all([
      this.loadHistory([row.id]),
      this.loadReporters([row.id]),
      this.loadAttachments([row.id]),
    ]);

    return toRequest(row, history.get(row.id) ?? [], reporters.get(row.id) ?? NO_ANSWERS, attachments.get(row.id) ?? []);
  }

  async listRequests(filter: RequestFilter): Promise<ServiceRequest[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.buildingId) {
      values.push(filter.buildingId);
      conditions.push(`building_id = $${values.length}`);
    }

    if (filter.authorId) {
      values.push(filter.authorId);
      conditions.push(`author_id = $${values.length}`);
    }

    if (filter.assigneeId) {
      values.push(filter.assigneeId);
      conditions.push(`assignee_id = $${values.length}`);
    }

    if (filter.statuses && filter.statuses.length > 0) {
      values.push(filter.statuses);
      conditions.push(`status = any($${values.length})`);
    }

    if (filter.createdAfter) {
      values.push(filter.createdAfter);
      conditions.push(`created_at > $${values.length}`);
    }

    if (filter.createdBefore) {
      values.push(filter.createdBefore);
      conditions.push(`created_at < $${values.length}`);
    }

    let reporter = '';

    if (filter.reporterId) {
      values.push(filter.reporterId);
      reporter = `$${values.length}`;
    }

    // Предел ставится всегда: обход без дома иначе поднимает заявки всех домов
    // вместе с историей и вложениями.
    values.push(filter.limit ?? REQUEST_LIMIT);
    const limit = ` limit $${values.length}`;

    const where = (extra?: string): string => {
      const all = extra ? [...conditions, extra] : conditions;

      return all.length > 0 ? `where ${all.join(' and ')}` : '';
    };

    // «Мои заявки» это две разные ветки отбора: свои заведённые и те, к которым
    // человек присоединился. Объединение проталкивает ограничение в каждую,
    // условие «или» проходило бы по всей таблице.
    const text = reporter
      ? `select * from (
             (select service_request.* from service_request
              ${where(`author_id = ${reporter}`)}
              order by created_at desc${limit})
           union
             (select service_request.* from service_request
              join request_reporter
                on request_reporter.request_id = service_request.id
               and request_reporter.resident_id = ${reporter}
              ${where()}
              order by created_at desc${limit})
         ) as reported
         order by created_at desc${limit}`
      : `select * from service_request ${where()} order by created_at desc${limit}`;

    const { rows } = await this.sql.query<RequestRow>(text, values);

    const ids = rows.map((row) => row.id);
    const [history, reporters, attachments] = await Promise.all([
      this.loadHistory(ids),
      this.loadReporters(ids),
      this.loadAttachments(ids),
    ]);

    return rows.map((row) =>
      toRequest(row, history.get(row.id) ?? [], reporters.get(row.id) ?? NO_ANSWERS, attachments.get(row.id) ?? []),
    );
  }

  async saveAnnouncement(announcement: Announcement): Promise<Announcement> {
    // Объявление и его адресаты пишутся вместе: обрыв между двумя запросами
    // оставлял объявление, которое никому не показывается.
    await this.atomically(async (sql) => {
      await sql.query(
        `insert into announcement
           (id, building_id, kind, entrance, riser, title, body, created_at,
            works_category, works_from, works_until, request_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          announcement.id,
          announcement.buildingId,
          announcement.audience.kind,
          announcement.audience.entrance ?? null,
          announcement.audience.riser ?? null,
          announcement.title,
          announcement.body,
          announcement.createdAt,
          announcement.works?.category ?? null,
          announcement.works?.from ?? null,
          announcement.works?.until ?? null,
          announcement.requestId ?? null,
        ],
      );

      if (announcement.recipientIds.length === 0) return;

      await sql.query(
        `insert into announcement_recipient (announcement_id, apartment_id)
         select $1, unnest($2::text[])`,
        [announcement.id, announcement.recipientIds],
      );
    });

    return announcement;
  }

  /** Работы, пересекающиеся с промежутком. */
  async listWorksBetween(buildingId: string, from: Date, to: Date): Promise<Announcement[]> {
    const { rows } = await this.sql.query<AnnouncementRow>(
      `select a.*, array_remove(array_agg(r.apartment_id), null) as recipient_ids
       from announcement a
       left join announcement_recipient r on r.announcement_id = a.id
       where a.building_id = $1
         and a.works_category is not null
         and a.works_until > $2
         and a.works_from <= $3
       group by a.id
       order by a.created_at desc`,
      [buildingId, from, to],
    );

    return rows.map(toAnnouncement);
  }

  async listAnnouncements(buildingId: string): Promise<Announcement[]> {
    const { rows } = await this.sql.query<AnnouncementRow>(
      `select a.*, array_remove(array_agg(r.apartment_id), null) as recipient_ids
       from announcement a
       left join announcement_recipient r on r.announcement_id = a.id
       where a.building_id = $1
       group by a.id
       order by a.created_at desc`,
      [buildingId],
    );

    return rows.map(toAnnouncement);
  }

  async savePoll(poll: Poll): Promise<Poll> {
    await this.sql.query(
      `insert into poll (
         id, building_id, kind, title, question, opens_at, closes_at, started_by, closed_at,
         elder_entrance, elder_resident_id, mode, notice_id, protocol_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (id) do update set
         title = excluded.title,
         question = excluded.question,
         opens_at = excluded.opens_at,
         closes_at = excluded.closes_at,
         closed_at = excluded.closed_at,
         elder_entrance = excluded.elder_entrance,
         elder_resident_id = excluded.elder_resident_id,
         mode = excluded.mode,
         notice_id = excluded.notice_id,
         protocol_id = excluded.protocol_id`,
      [
        poll.id,
        poll.buildingId,
        poll.kind,
        poll.title,
        poll.question,
        poll.opensAt,
        poll.closesAt,
        poll.startedBy ?? null,
        poll.closedAt ?? null,
        poll.elder?.entrance ?? null,
        poll.elder?.residentId ?? null,
        poll.mode ?? 'meeting',
        poll.noticeId ?? null,
        poll.protocolId ?? null,
      ],
    );

    return poll;
  }

  async findPoll(pollId: string): Promise<Poll | undefined> {
    const { rows } = await this.sql.query<PollRow>('select * from poll where id = $1', [pollId]);

    return rows[0] ? toPoll(rows[0]) : undefined;
  }

  async listPolls(buildingId: string): Promise<Poll[]> {
    const { rows } = await this.sql.query<PollRow>(
      'select * from poll where building_id = $1 order by closes_at desc',
      [buildingId],
    );

    return rows.map(toPoll);
  }

  async saveVote(vote: Vote): Promise<Vote> {
    await this.sql.query(
      `insert into poll_vote (poll_id, apartment_id, choice, at, resident_id)
       values ($1, $2, $3, $4, $5)
       on conflict (poll_id, apartment_id) do update set
         choice = excluded.choice,
         at = excluded.at,
         resident_id = excluded.resident_id`,
      [vote.pollId, vote.apartmentId, vote.choice, vote.at, vote.residentId],
    );

    return vote;
  }

  async listVotes(pollId: string): Promise<Vote[]> {
    const { rows } = await this.sql.query<VoteRow>('select * from poll_vote where poll_id = $1 order by at', [pollId]);

    return rows.map((row) => ({
      pollId: row.poll_id,
      apartmentId: row.apartment_id,
      choice: row.choice,
      at: row.at,
      residentId: row.resident_id,
    }));
  }

  async saveEldership(eldership: Eldership): Promise<Eldership> {
    await this.sql.query(
      `insert into eldership (building_id, entrance, resident_id, since, until)
       values ($1, $2, $3, $4, $5)
       on conflict (building_id, entrance) do update set
         resident_id = excluded.resident_id,
         since = excluded.since,
         until = excluded.until`,
      [eldership.buildingId, eldership.entrance, eldership.residentId, eldership.since, eldership.until],
    );

    return eldership;
  }

  async listElderships(buildingId: string): Promise<Eldership[]> {
    const { rows } = await this.sql.query<EldershipRow>(
      'select * from eldership where building_id = $1 order by entrance',
      [buildingId],
    );

    return rows.map((row) => ({
      buildingId: row.building_id,
      entrance: row.entrance,
      residentId: row.resident_id,
      since: row.since,
      until: row.until,
    }));
  }

  async saveInitiative(initiative: Initiative): Promise<Initiative> {
    const write = async (sql: SqlClient): Promise<void> => {
      await sql.query(
        `insert into initiative (id, building_id, author_id, kind, title, question, created_at, poll_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set
           title = excluded.title,
           question = excluded.question,
           kind = excluded.kind,
           poll_id = excluded.poll_id`,
        [
          initiative.id,
          initiative.buildingId,
          initiative.authorId,
          initiative.kind,
          initiative.title,
          initiative.question,
          initiative.createdAt,
          initiative.pollId ?? null,
        ],
      );

      if (initiative.signatures.length === 0) return;

      await sql.query(
        `insert into initiative_signature (initiative_id, apartment_id, resident_id, at)
         select $1, apartment_id, resident_id, at
         from unnest($2::text[], $3::text[], $4::timestamptz[]) as signed (apartment_id, resident_id, at)
         on conflict do nothing`,
        [
          initiative.id,
          initiative.signatures.map((signature) => signature.apartmentId),
          initiative.signatures.map((signature) => signature.residentId),
          initiative.signatures.map((signature) => signature.at),
        ],
      );
    };

    if (this.sql.transaction) await this.sql.transaction(write);
    else await write(this.sql);

    return initiative;
  }

  async findInitiative(id: string): Promise<Initiative | undefined> {
    const { rows } = await this.sql.query<InitiativeRow>('select * from initiative where id = $1', [id]);
    const row = rows[0];

    if (!row) return undefined;

    const [initiative] = await this.withSignatures([row]);

    return initiative;
  }

  async listInitiatives(buildingId: string): Promise<Initiative[]> {
    const { rows } = await this.sql.query<InitiativeRow>(
      'select * from initiative where building_id = $1 order by created_at desc',
      [buildingId],
    );

    return this.withSignatures(rows);
  }

  private async withSignatures(rows: readonly InitiativeRow[]): Promise<Initiative[]> {
    if (rows.length === 0) return [];

    const { rows: signatures } = await this.sql.query<SignatureRow>(
      'select * from initiative_signature where initiative_id = any($1::text[]) order by at',
      [rows.map((row) => row.id)],
    );

    return rows.map((row) => ({
      id: row.id,
      buildingId: row.building_id,
      authorId: row.author_id,
      kind: row.kind,
      title: row.title,
      question: row.question,
      createdAt: row.created_at,
      signatures: signatures
        .filter((signature) => signature.initiative_id === row.id)
        .map((signature) => ({
          residentId: signature.resident_id,
          apartmentId: signature.apartment_id,
          at: signature.at,
        })),
      ...(row.poll_id ? { pollId: row.poll_id } : {}),
    }));
  }

  async saveMeter(meter: Meter): Promise<Meter> {
    await this.sql.query(
      `insert into meter (id, apartment_id, kind, serial, verified_until)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set
         kind = excluded.kind,
         serial = excluded.serial,
         verified_until = excluded.verified_until`,
      [meter.id, meter.apartmentId, meter.kind, meter.serial, meter.verifiedUntil ?? null],
    );

    return meter;
  }

  async listMeters(apartmentId: string): Promise<Meter[]> {
    const { rows } = await this.sql.query<MeterRow>('select * from meter where apartment_id = $1 order by kind', [
      apartmentId,
    ]);

    return rows.map(toMeter);
  }

  async listMetersByApartments(apartmentIds: readonly string[]): Promise<Meter[]> {
    if (apartmentIds.length === 0) return [];

    const { rows } = await this.sql.query<MeterRow>(
      'select * from meter where apartment_id = any($1) order by apartment_id, kind',
      [[...apartmentIds]],
    );

    return rows.map(toMeter);
  }

  async findMeter(meterId: string): Promise<Meter | undefined> {
    const { rows } = await this.sql.query<MeterRow>('select * from meter where id = $1', [meterId]);

    return rows[0] ? toMeter(rows[0]) : undefined;
  }

  /** Показание на момент времени одно: повтор заменяет прежнее, а не падает. */
  async saveReading(reading: Reading): Promise<Reading> {
    const { rows } = await this.sql.query<{ id: string }>(
      `insert into meter_reading (id, meter_id, value, at, submitted_by) values ($1, $2, $3, $4, $5)
       on conflict (meter_id, at) do update set
         value = excluded.value,
         submitted_by = excluded.submitted_by
       returning id`,
      [reading.id, reading.meterId, reading.value, reading.at, reading.submittedBy],
    );

    const id = rows[0]?.id;

    return id && id !== reading.id ? { ...reading, id } : reading;
  }

  async listReadings(meterId: string): Promise<Reading[]> {
    const { rows } = await this.sql.query<ReadingRow>(
      'select * from meter_reading where meter_id = $1 order by at desc',
      [meterId],
    );

    return rows.map(toReading);
  }

  async listReadingsFor(meterIds: readonly string[]): Promise<Reading[]> {
    if (meterIds.length === 0) return [];

    const { rows } = await this.sql.query<ReadingRow>(
      'select * from meter_reading where meter_id = any($1) order by at desc',
      [[...meterIds]],
    );

    return rows.map(toReading);
  }

  async deleteReading(readingId: string): Promise<void> {
    await this.sql.query('delete from meter_reading where id = $1', [readingId]);
  }

  /** Прибор на ресурс в доме один: два заведения подряд не расходятся ошибкой. */
  async saveHouseMeter(meter: HouseMeter): Promise<HouseMeter> {
    const { rows } = await this.sql.query<{ id: string }>(
      `insert into house_meter (id, building_id, kind, serial, verified_until) values ($1, $2, $3, $4, $5)
       on conflict (building_id, kind) do update set
         serial = excluded.serial,
         verified_until = excluded.verified_until
       returning id`,
      [meter.id, meter.buildingId, meter.kind, meter.serial, meter.verifiedUntil ?? null],
    );

    const id = rows[0]?.id;

    return id && id !== meter.id ? { ...meter, id } : meter;
  }

  async listHouseMeters(buildingId: string): Promise<HouseMeter[]> {
    const { rows } = await this.sql.query<HouseMeterRow>(
      'select * from house_meter where building_id = $1 order by kind',
      [buildingId],
    );

    return rows.map(toHouseMeter);
  }

  async findHouseMeter(meterId: string): Promise<HouseMeter | undefined> {
    const { rows } = await this.sql.query<HouseMeterRow>('select * from house_meter where id = $1', [meterId]);

    return rows[0] ? toHouseMeter(rows[0]) : undefined;
  }

  /** Показание на момент времени одно: повтор заменяет прежнее, а не падает. */
  async saveHouseReading(reading: Reading): Promise<Reading> {
    const { rows } = await this.sql.query<{ id: string }>(
      `insert into house_meter_reading (id, meter_id, value, at, submitted_by) values ($1, $2, $3, $4, $5)
       on conflict (meter_id, at) do update set
         value = excluded.value,
         submitted_by = excluded.submitted_by
       returning id`,
      [reading.id, reading.meterId, reading.value, reading.at, reading.submittedBy],
    );

    const id = rows[0]?.id;

    return id && id !== reading.id ? { ...reading, id } : reading;
  }

  async listHouseReadingsFor(meterIds: readonly string[]): Promise<Reading[]> {
    if (meterIds.length === 0) return [];

    const { rows } = await this.sql.query<ReadingRow>(
      'select * from house_meter_reading where meter_id = any($1) order by at desc',
      [[...meterIds]],
    );

    return rows.map(toReading);
  }

  async deleteHouseReading(readingId: string): Promise<void> {
    await this.sql.query('delete from house_meter_reading where id = $1', [readingId]);
  }

  /** Осмотр целиком: пункты и вложения переписываются вместе с ним. */
  async saveInspection(inspection: Inspection): Promise<Inspection> {
    const write = async (sql: SqlClient): Promise<void> => {
      await sql.query(
        `insert into inspection
           (id, building_id, kind, entrance, due_at, created_at, assignee_id, finished_at, equipment_code, on_site)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (id) do update set
           entrance = excluded.entrance,
           equipment_code = excluded.equipment_code,
           due_at = excluded.due_at,
           assignee_id = excluded.assignee_id,
           finished_at = excluded.finished_at,
           on_site = excluded.on_site`,
        [
          inspection.id,
          inspection.buildingId,
          inspection.kind,
          inspection.entrance ?? null,
          inspection.dueAt,
          inspection.createdAt,
          inspection.assigneeId ?? null,
          inspection.finishedAt ?? null,
          inspection.equipmentCode ?? null,
          inspection.onSite ?? false,
        ],
      );

      await sql.query('delete from inspection_item where inspection_id = $1', [inspection.id]);
      await sql.query('delete from inspection_item_attachment where inspection_id = $1', [inspection.id]);

      const items = [...inspection.items.entries()];

      if (items.length > 0) {
        await sql.query(
          `insert into inspection_item (inspection_id, position, title, state, comment, checked_at)
           select $1, position, title, state, comment, checked_at
           from unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::timestamptz[])
             as item (position, title, state, comment, checked_at)`,
          [
            inspection.id,
            items.map(([position]) => position),
            items.map(([, item]) => item.title),
            items.map(([, item]) => item.state ?? null),
            items.map(([, item]) => item.comment ?? null),
            items.map(([, item]) => item.at ?? null),
          ],
        );
      }

      const files = items.flatMap(([position, item]) =>
        (item.attachments ?? []).map((attachment) => ({ position, attachment })),
      );

      if (files.length > 0) {
        await sql.query(
          `insert into inspection_item_attachment (inspection_id, position, kind, token, transcript)
           select $1, position, kind, token, transcript
           from unnest($2::int[], $3::text[], $4::text[], $5::text[]) as file (position, kind, token, transcript)
           on conflict do nothing`,
          [
            inspection.id,
            files.map((file) => file.position),
            files.map((file) => file.attachment.kind),
            files.map((file) => file.attachment.token),
            files.map((file) => file.attachment.transcript ?? null),
          ],
        );
      }

      if (inspection.requestIds.length > 0) {
        await sql.query(
          `insert into inspection_request (inspection_id, request_id)
           select $1, unnest($2::text[])
           on conflict do nothing`,
          [inspection.id, [...inspection.requestIds]],
        );
      }
    };

    if (this.sql.transaction) await this.sql.transaction(write);
    else await write(this.sql);

    return inspection;
  }

  async findInspection(id: string): Promise<Inspection | undefined> {
    const { rows } = await this.sql.query<InspectionRow>('select * from inspection where id = $1', [id]);
    const row = rows[0];

    if (!row) return undefined;

    const [inspection] = await this.hydrate([row]);

    return inspection;
  }

  async listInspections(buildingId: string): Promise<Inspection[]> {
    const { rows } = await this.sql.query<InspectionRow>(
      'select * from inspection where building_id = $1 order by due_at',
      [buildingId],
    );

    return this.hydrate(rows);
  }

  async saveBindAttempt(attempt: BindAttempt): Promise<void> {
    await this.sql.query('insert into bind_attempt (resident_id, at, ok) values ($1, $2, $3)', [
      attempt.residentId,
      attempt.at,
      attempt.ok,
    ]);
  }

  async countBindAttempts(residentId: string, since: Date): Promise<number> {
    const { rows } = await this.sql.query<{ count: string }>(
      'select count(*) from bind_attempt where resident_id = $1 and at >= $2 and not ok',
      [residentId, since],
    );

    return Number(rows[0]?.count ?? 0);
  }

  async saveHandoff(handoff: Handoff): Promise<Handoff> {
    await this.sql.query(
      `insert into handoff (
         id, request_id, building_id, target, organization, channel,
         external_id, status, due_at, answer, created_at, answered_at, by_resident
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (id) do update set
         external_id = excluded.external_id,
         status = excluded.status,
         due_at = excluded.due_at,
         answer = excluded.answer,
         answered_at = excluded.answered_at`,
      [
        handoff.id,
        handoff.requestId,
        handoff.buildingId,
        handoff.to,
        handoff.organization,
        handoff.channel,
        orNull(handoff.externalId),
        handoff.status,
        handoff.dueAt,
        orNull(handoff.answer),
        handoff.createdAt,
        handoff.answeredAt ?? null,
        handoff.byResident === true,
      ],
    );

    return handoff;
  }

  async findHandoff(handoffId: string): Promise<Handoff | undefined> {
    const { rows } = await this.sql.query<HandoffRow>('select * from handoff where id = $1', [handoffId]);

    return rows[0] ? toHandoff(rows[0]) : undefined;
  }

  async listHandoffs(filter: HandoffFilter): Promise<Handoff[]> {
    const { rows } = await this.sql.query<HandoffRow>(
      `select * from handoff
       where ($1::text is null or request_id = $1)
         and ($2::text is null or building_id = $2)
         and ($3::boolean is not true or status not in ('answered', 'failed'))
       order by created_at`,
      [filter.requestId ?? null, filter.buildingId ?? null, filter.waiting ?? null],
    );

    return rows.map(toHandoff);
  }

  async saveVisit(visit: Visit): Promise<Visit> {
    await this.sql.query(
      `insert into visit (id, building_id, resident_id, at, minutes, topic, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set
         at = excluded.at,
         minutes = excluded.minutes,
         topic = excluded.topic,
         status = excluded.status`,
      [
        visit.id,
        visit.buildingId,
        visit.residentId,
        visit.at,
        visit.minutes,
        visit.topic,
        visit.status,
        visit.createdAt,
      ],
    );

    return visit;
  }

  async findVisit(visitId: string): Promise<Visit | undefined> {
    const { rows } = await this.sql.query<VisitRow>('select * from visit where id = $1', [visitId]);

    return rows[0] ? toVisit(rows[0]) : undefined;
  }

  async listVisits(filter: VisitFilter): Promise<Visit[]> {
    const { rows } = await this.sql.query<VisitRow>(
      `select * from visit
       where ($1::text is null or building_id = $1)
         and ($2::text is null or resident_id = $2)
         and ($3::text[] is null or status = any($3))
         and ($4::timestamptz is null or at >= $4)
       order by at`,
      [filter.buildingId ?? null, filter.residentId ?? null, filter.statuses ?? null, filter.from ?? null],
    );

    return rows.map(toVisit);
  }

  async saveSupportTicket(ticket: SupportTicket): Promise<SupportTicket> {
    const write = async (sql: SqlClient): Promise<void> => {
      await sql.query(
        `insert into support_ticket (id, building_id, resident_id, subject, status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set
           subject = excluded.subject,
           status = excluded.status,
           updated_at = excluded.updated_at`,
        [
          ticket.id,
          ticket.buildingId,
          ticket.residentId,
          ticket.subject,
          ticket.status,
          ticket.createdAt,
          ticket.updatedAt,
        ],
      );

      // Ключ реплики собирается из времени и автора: по порядковому номеру
      // одновременные ответы смены и жильца получали один и тот же.
      const talk = new Map<string, TicketMessage>();

      for (const message of ticket.messages) {
        talk.set(`${ticket.id}:${message.at.getTime()}:${message.authorId}`, message);
      }

      const replies = [...talk.entries()].map(([id, message]) => ({ id, message }));

      if (replies.length === 0) return;

      await sql.query(
        `insert into support_message (id, ticket_id, at, author_side, author_id, author_name, text)
         select id, $1, at, author_side, author_id, author_name, text
         from unnest($2::text[], $3::timestamptz[], $4::text[], $5::text[], $6::text[], $7::text[])
           as reply (id, at, author_side, author_id, author_name, text)
         on conflict (id) do update set
           author_name = excluded.author_name,
           text = excluded.text`,
        [
          ticket.id,
          replies.map((reply) => reply.id),
          replies.map((reply) => reply.message.at),
          replies.map((reply) => reply.message.from),
          replies.map((reply) => reply.message.authorId),
          replies.map((reply) => reply.message.authorName ?? null),
          replies.map((reply) => reply.message.text),
        ],
      );

      const files = replies.flatMap((reply) =>
        (reply.message.attachments ?? []).map((attachment, position) => ({ id: reply.id, position, attachment })),
      );

      if (files.length === 0) return;

      await sql.query(
        `insert into support_attachment (message_id, position, kind, token, transcript)
         select message_id, position, kind, token, transcript
         from unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[])
           as file (message_id, position, kind, token, transcript)
         on conflict (message_id, position) do update set
           kind = excluded.kind,
           token = excluded.token,
           transcript = excluded.transcript`,
        [
          files.map((file) => file.id),
          files.map((file) => file.position),
          files.map((file) => file.attachment.kind),
          files.map((file) => file.attachment.token),
          files.map((file) => file.attachment.transcript ?? null),
        ],
      );
    };

    if (this.sql.transaction) await this.sql.transaction(write);
    else await write(this.sql);

    return ticket;
  }

  async findSupportTicket(ticketId: string): Promise<SupportTicket | undefined> {
    const { rows } = await this.sql.query<TicketRow>('select * from support_ticket where id = $1', [ticketId]);
    const row = rows[0];

    if (!row) return undefined;

    const [ticket] = await this.withMessages([row]);

    return ticket;
  }

  async listSupportTickets(filter: SupportFilter): Promise<SupportTicket[]> {
    const { rows } = await this.sql.query<TicketRow>(
      `select * from support_ticket
       where ($1::text is null or building_id = $1)
         and ($2::text is null or resident_id = $2)
         and ($3::ticket_status[] is null or status = any($3))
       order by updated_at desc`,
      [filter.buildingId ?? null, filter.residentId ?? null, filter.statuses ?? null],
    );

    return this.withMessages(rows);
  }

  /** Дочитывает переписку и вложения: обращение без реплик ничего не значит. */
  private async withMessages(rows: readonly TicketRow[]): Promise<SupportTicket[]> {
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);

    const messages = await this.sql.query<TicketMessageRow>(
      'select * from support_message where ticket_id = any($1) order by at, seq',
      [ids],
    );

    const attachments = await this.sql.query<{
      message_id: string;
      kind: Attachment['kind'];
      token: string;
      transcript: string | null;
    }>(
      `select a.* from support_attachment a
       join support_message m on m.id = a.message_id
       where m.ticket_id = any($1)
       order by a.position`,
      [ids],
    );

    const filesOf = new Map<string, Attachment[]>();

    for (const file of attachments.rows) {
      filesOf.set(file.message_id, [
        ...(filesOf.get(file.message_id) ?? []),
        {
          kind: file.kind,
          token: file.token,
          ...(file.transcript === null ? {} : { transcript: file.transcript }),
        },
      ]);
    }

    const talk = new Map<string, TicketMessage[]>();

    for (const message of messages.rows) {
      const files = filesOf.get(message.id) ?? [];

      talk.set(message.ticket_id, [
        ...(talk.get(message.ticket_id) ?? []),
        {
          at: message.at,
          from: message.author_side,
          authorId: message.author_id,
          ...(message.author_name === null ? {} : { authorName: message.author_name }),
          text: message.text,
          ...(files.length > 0 ? { attachments: files } : {}),
        },
      ]);
    }

    return rows.map((row) => ({
      id: row.id,
      buildingId: row.building_id,
      residentId: row.resident_id,
      subject: row.subject,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: talk.get(row.id) ?? [],
    }));
  }

  async saveTariff(record: TariffRecord): Promise<void> {
    await this.sql.query(
      `insert into tariff (building_id, kind, value, since)
       values ($1, $2, $3, $4)
       on conflict (building_id, kind, since) do update set value = excluded.value`,
      [record.buildingId, record.kind, record.value, record.since],
    );
  }

  async listTariffs(buildingId: string): Promise<TariffRecord[]> {
    const { rows } = await this.sql.query<{ building_id: string; kind: TariffRecord['kind']; value: string; since: Date }>(
      'select * from tariff where building_id = $1 order by since',
      [buildingId],
    );

    return rows.map((row) => ({
      buildingId: row.building_id,
      kind: row.kind,
      value: Number(row.value),
      since: row.since,
    }));
  }

  async saveAudit(entry: AuditEntry): Promise<void> {
    await this.sql.query(
      `insert into audit_entry (id, at, actor_id, actor_name, action, building_id, subject, details)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do nothing`,
      [
        entry.id,
        entry.at,
        entry.actorId,
        entry.actorName,
        entry.action,
        entry.buildingId,
        entry.subject ?? null,
        entry.details ?? null,
      ],
    );
  }

  async listAudit(buildingId: string, page: { limit: number; before?: Date }): Promise<AuditEntry[]> {
    const { rows } = await this.sql.query<AuditRow>(
      `select * from audit_entry
       where building_id = $1 and ($2::timestamptz is null or at < $2)
       order by at desc
       limit $3`,
      [buildingId, page.before ?? null, page.limit],
    );

    return rows.map(toAudit);
  }

  /** Дочитывает пункты осмотра, вложения и заведённые по ним заявки. */
  private async hydrate(rows: readonly InspectionRow[]): Promise<Inspection[]> {
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);

    const [items, attachments, requests] = await Promise.all([
      this.sql.query<InspectionItemRow>(
        'select * from inspection_item where inspection_id = any($1) order by position',
        [ids],
      ),
      this.sql.query<{ inspection_id: string; position: number; kind: string; token: string; transcript: string | null }>(
        'select * from inspection_item_attachment where inspection_id = any($1)',
        [ids],
      ),
      this.sql.query<{ inspection_id: string; request_id: string }>(
        'select * from inspection_request where inspection_id = any($1)',
        [ids],
      ),
    ]);

    return rows.map((row) => ({
      id: row.id,
      buildingId: row.building_id,
      kind: row.kind,
      ...(row.entrance === null ? {} : { entrance: row.entrance }),
      ...(row.equipment_code ? { equipmentCode: row.equipment_code } : {}),
      dueAt: row.due_at,
      createdAt: row.created_at,
      ...(row.assignee_id ? { assigneeId: row.assignee_id } : {}),
      ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
      ...(row.on_site ? { onSite: true } : {}),
      items: items.rows
        .filter((item) => item.inspection_id === row.id)
        .map((item) => {
          const own = attachments.rows.filter(
            (file) => file.inspection_id === row.id && file.position === item.position,
          );

          return {
            title: item.title,
            ...(item.state ? { state: item.state as 'ok' | 'problem' } : {}),
            ...(item.comment ? { comment: item.comment } : {}),
            ...(item.checked_at ? { at: item.checked_at } : {}),
            ...(own.length > 0
              ? {
                  attachments: own.map((file) => ({
                    kind: file.kind as 'photo' | 'voice' | 'file',
                    token: file.token,
                    ...(file.transcript ? { transcript: file.transcript } : {}),
                  })),
                }
              : {}),
          };
        }),
      requestIds: requests.rows.filter((link) => link.inspection_id === row.id).map((link) => link.request_id),
    }));
  }

  /** Ответы соседей: подтверждения и «у меня работает» лежат вместе, разделяет флаг. */
  private async loadReporters(ids: readonly string[]): Promise<Map<string, Answers>> {
    const grouped = new Map<string, Answers>();

    if (ids.length === 0) return grouped;

    const { rows } = await this.sql.query<{
      request_id: string;
      resident_id: string;
      at: Date;
      affected: boolean;
    }>(
      `select request_id, resident_id, at, affected from request_reporter
       where request_id = any($1) order by at, resident_id`,
      [ids],
    );

    for (const row of rows) {
      const answers = grouped.get(row.request_id) ?? { joinedBy: [], notAffected: [] };
      const join: RequestJoin = { residentId: row.resident_id, at: row.at };

      if (row.affected) answers.joinedBy.push(join);
      else answers.notAffected.push(join);

      grouped.set(row.request_id, answers);
    }

    return grouped;
  }

  private async loadAttachments(ids: readonly string[]): Promise<Map<string, Attachment[]>> {
    const grouped = new Map<string, Attachment[]>();

    if (ids.length === 0) return grouped;

    const { rows } = await this.sql.query<{
      request_id: string;
      kind: Attachment['kind'];
      token: string;
      transcript: string | null;
    }>(
      'select request_id, kind, token, transcript from request_attachment where request_id = any($1) order by id',
      [ids],
    );

    for (const row of rows) {
      const attachment: Attachment = {
        kind: row.kind,
        token: row.token,
        ...(row.transcript === null ? {} : { transcript: row.transcript }),
      };

      grouped.set(row.request_id, [...(grouped.get(row.request_id) ?? []), attachment]);
    }

    return grouped;
  }

  private async loadHistory(requestIds: readonly string[]): Promise<Map<string, RequestEvent[]>> {
    const history = new Map<string, RequestEvent[]>();
    if (requestIds.length === 0) return history;

    const { rows } = await this.sql.query<EventRow>(
      'select * from request_event where request_id = any($1) order by at, id',
      [requestIds],
    );

    const attachments = await this.loadEventAttachments(rows.map((row) => row.id));

    for (const row of rows) {
      const events = history.get(row.request_id) ?? [];
      const attached = attachments.get(row.id);

      events.push({
        at: row.at,
        status: row.status,
        role: row.role,
        actorId: row.actor_id,
        ...(row.is_message ? { kind: 'message' as const } : {}),
        ...(row.comment ? { comment: row.comment } : {}),
        ...(row.assignee_id ? { assigneeId: row.assignee_id } : {}),
        ...(attached ? { attachments: attached } : {}),
        ...(row.on_site ? { onSite: true } : {}),
      });

      history.set(row.request_id, events);
    }

    return history;
  }

  /** Снимки, приложенные к переходам: одним запросом на всю прочитанную историю. */
  private async loadEventAttachments(eventIds: readonly string[]): Promise<Map<string, Attachment[]>> {
    const grouped = new Map<string, Attachment[]>();
    if (eventIds.length === 0) return grouped;

    const { rows } = await this.sql.query<{
      event_id: string;
      kind: Attachment['kind'];
      token: string;
      transcript: string | null;
    }>(
      'select event_id, kind, token, transcript from request_event_attachment where event_id = any($1) order by id',
      [eventIds],
    );

    for (const row of rows) {
      const attachment: Attachment = {
        kind: row.kind,
        token: row.token,
        ...(row.transcript === null ? {} : { transcript: row.transcript }),
      };

      grouped.set(row.event_id, [...(grouped.get(row.event_id) ?? []), attachment]);
    }

    return grouped;
  }
}

/** Событие истории одной строкой: по ней событие и узнаётся в базе. */
const eventKey = (parts: {
  at: Date;
  actorId: string;
  status: string;
  isMessage: boolean;
  comment: string | null;
}): string =>
  [parts.at.getTime(), parts.actorId, parts.status, parts.isMessage, parts.comment ?? ''].join('\0');

/**
 * Состояние заявки по её истории: последний переход, сообщения его не меняют.
 * Без этого колонка статуса расходится с историей, когда заявку сохраняют
 * с двух сторон сразу.
 */
const settledStatus = async (
  sql: SqlClient,
  requestId: string,
  fallback: ServiceRequest['status'],
): Promise<ServiceRequest['status']> => {
  const { rows } = await sql.query<{ status: ServiceRequest['status'] }>(
    `select status from request_event
     where request_id = $1 and not is_message
     order by at desc, id desc
     limit 1`,
    [requestId],
  );

  return rows[0]?.status ?? fallback;
};

/**
 * Дописывает недостающие события истории. Событие узнаётся по содержанию, а не
 * по своему месту в списке: одновременное сохранение одной заявки с разных
 * сторон иначе теряет второе событие.
 */
const appendHistory = async (sql: SqlClient, request: ServiceRequest): Promise<void> => {
  if (request.history.length === 0) return;

  const { rows } = await sql.query<{
    id: string;
    at: Date;
    actor_id: string;
    status: string;
    is_message: boolean;
    comment: string | null;
  }>(
    `insert into request_event (request_id, actor_id, status, role, comment, at, assignee_id, is_message, on_site)
     select $1, actor_id, status, role, comment, at, assignee_id, is_message, on_site
     from unnest($2::text[], $3::request_status[], $4::role[], $5::text[], $6::timestamptz[],
                 $7::text[], $8::boolean[], $9::boolean[])
       as event (actor_id, status, role, comment, at, assignee_id, is_message, on_site)
     on conflict do nothing
     returning id, at, actor_id, status, is_message, comment`,
    [
      request.id,
      request.history.map((event) => event.actorId),
      request.history.map((event) => event.status),
      request.history.map((event) => event.role),
      request.history.map((event) => event.comment ?? null),
      request.history.map((event) => event.at),
      request.history.map((event) => event.assigneeId ?? null),
      request.history.map((event) => event.kind === 'message'),
      request.history.map((event) => event.onSite ?? false),
    ],
  );

  if (rows.length === 0) return;

  const idOf = new Map(
    rows.map((row) => [
      eventKey({
        at: row.at,
        actorId: row.actor_id,
        status: row.status,
        isMessage: row.is_message,
        comment: row.comment,
      }),
      row.id,
    ]),
  );

  const files: { eventId: string; attachment: Attachment }[] = [];

  for (const event of request.history) {
    const eventId = idOf.get(
      eventKey({
        at: event.at,
        actorId: event.actorId,
        status: event.status,
        isMessage: event.kind === 'message',
        comment: event.comment ?? null,
      }),
    );

    if (!eventId) continue;

    for (const attachment of event.attachments ?? []) files.push({ eventId, attachment });
  }

  if (files.length === 0) return;

  await sql.query(
    `insert into request_event_attachment (event_id, kind, token, transcript)
     select event_id, kind, token, transcript
     from unnest($1::bigint[], $2::text[], $3::text[], $4::text[]) as file (event_id, kind, token, transcript)`,
    [
      files.map((file) => file.eventId),
      files.map((file) => file.attachment.kind),
      files.map((file) => file.attachment.token),
      files.map((file) => file.attachment.transcript ?? null),
    ],
  );
};

/**
 * Соседи, сообщившие о той же проблеме. Ответ переписывается: сосед, сначала
 * ответивший «у меня всё работает», потом присоединяется к заявке.
 */
const saveReporters = async (sql: SqlClient, request: ServiceRequest): Promise<void> => {
  const latest = new Map<string, { residentId: string; at: Date; affected: boolean }>();

  for (const answer of [
    ...request.notAffected.map((join) => ({ ...join, affected: false })),
    ...request.joinedBy.map((join) => ({ ...join, affected: true })),
  ]) {
    const known = latest.get(answer.residentId);

    // Строка на жильца одна, поэтому до записи остаётся только последний ответ.
    if (!known || known.at.getTime() <= answer.at.getTime()) latest.set(answer.residentId, answer);
  }

  const answers = [...latest.values()];

  if (answers.length === 0) return;

  await sql.query(
    `insert into request_reporter (request_id, resident_id, at, affected)
     select $1, resident_id, at, affected
     from unnest($2::text[], $3::timestamptz[], $4::boolean[]) as answered (resident_id, at, affected)
     on conflict (request_id, resident_id) do update set
       at = excluded.at,
       affected = excluded.affected`,
    [
      request.id,
      answers.map((answer) => answer.residentId),
      answers.map((answer) => answer.at),
      answers.map((answer) => answer.affected),
    ],
  );
};

/**
 * Вложения заявки. Файл узнаётся по своему токену, а не по месту в списке:
 * повтор сохранения после таймаута иначе удваивает вложения.
 */
const saveAttachments = async (sql: SqlClient, request: ServiceRequest): Promise<void> => {
  if (request.attachments.length === 0) return;

  // Строка на токен одна, поэтому повтор внутри списка до записи не доходит.
  const files = new Map(request.attachments.map((attachment) => [attachment.token, attachment]));
  const attachments = [...files.values()];

  // Расшифровка голосового доезжает позже самого файла, поэтому обновляется.
  await sql.query(
    `insert into request_attachment (request_id, kind, token, transcript)
     select $1, kind, token, transcript
     from unnest($2::text[], $3::text[], $4::text[]) as file (kind, token, transcript)
     on conflict (request_id, token) do update set
       transcript = coalesce(excluded.transcript, request_attachment.transcript)`,
    [
      request.id,
      attachments.map((attachment) => attachment.kind),
      attachments.map((attachment) => attachment.token),
      attachments.map((attachment) => attachment.transcript ?? null),
    ],
  );
};

interface MeterRow {
  id: string;
  apartment_id: string;
  kind: Meter['kind'];
  serial: string;
  verified_until: Date | null;
}

interface InspectionRow {
  id: string;
  building_id: string;
  kind: InspectionKind;
  entrance: number | null;
  due_at: Date;
  created_at: Date;
  assignee_id: string | null;
  finished_at: Date | null;
  equipment_code: string | null;
  on_site: boolean;
}

interface InspectionItemRow {
  inspection_id: string;
  position: number;
  title: string;
  state: string | null;
  comment: string | null;
  checked_at: Date | null;
}

interface ReadingRow {
  id: string;
  meter_id: string;
  value: string;
  at: Date;
  submitted_by: string;
}

interface HouseMeterRow {
  id: string;
  building_id: string;
  kind: Meter['kind'];
  serial: string;
  verified_until: Date | null;
}

const toHouseMeter = (row: HouseMeterRow): HouseMeter => ({
  id: row.id,
  buildingId: row.building_id,
  kind: row.kind,
  serial: row.serial,
  ...(row.verified_until === null ? {} : { verifiedUntil: row.verified_until }),
});

const toMeter = (row: MeterRow): Meter => ({
  id: row.id,
  apartmentId: row.apartment_id,
  kind: row.kind,
  serial: row.serial,
  ...(row.verified_until === null ? {} : { verifiedUntil: row.verified_until }),
});

const toReading = (row: ReadingRow): Reading => ({
  id: row.id,
  meterId: row.meter_id,
  value: Number(row.value),
  at: row.at,
  submittedBy: row.submitted_by,
});

interface EquipmentRow {
  building_id: string;
  code: string;
  title: string;
  kind: Equipment['kind'] | null;
}

const toEquipment = (row: EquipmentRow): Equipment => ({
  buildingId: row.building_id,
  code: row.code,
  title: row.title,
  ...(row.kind ? { kind: row.kind } : {}),
});

interface TicketRow {
  id: string;
  building_id: string;
  resident_id: string;
  subject: string;
  status: SupportTicket['status'];
  created_at: Date;
  updated_at: Date;
}

interface TicketMessageRow {
  id: string;
  ticket_id: string;
  at: Date;
  author_side: TicketMessage['from'];
  author_id: string;
  author_name: string | null;
  text: string;
}

interface AuditRow {
  id: string;
  at: Date;
  actor_id: string;
  actor_name: string;
  action: AuditEntry['action'];
  building_id: string;
  subject: string | null;
  details: string | null;
}

const toAudit = (row: AuditRow): AuditEntry => ({
  id: row.id,
  at: row.at,
  actorId: row.actor_id,
  actorName: row.actor_name,
  action: row.action,
  buildingId: row.building_id,
  ...(row.subject ? { subject: row.subject } : {}),
  ...(row.details ? { details: row.details } : {}),
});

interface PollRow {
  id: string;
  building_id: string;
  kind: Poll['kind'];
  title: string;
  question: string;
  opens_at: Date;
  closes_at: Date;
  started_by: string | null;
  closed_at: Date | null;
  elder_entrance: number | null;
  elder_resident_id: string | null;
  mode: string | null;
  notice_id: string | null;
  protocol_id: string | null;
}

interface EldershipRow {
  building_id: string;
  entrance: number;
  resident_id: string;
  since: Date;
  until: Date;
}

interface InitiativeRow {
  id: string;
  building_id: string;
  author_id: string;
  kind: Poll['kind'];
  title: string;
  question: string;
  created_at: Date;
  poll_id: string | null;
}

interface SignatureRow {
  initiative_id: string;
  apartment_id: string;
  resident_id: string;
  at: Date;
}

interface VoteRow {
  poll_id: string;
  apartment_id: string;
  choice: Vote['choice'];
  at: Date;
  resident_id: string;
}

const toPoll = (row: PollRow): Poll => ({
  id: row.id,
  buildingId: row.building_id,
  kind: row.kind,
  title: row.title,
  question: row.question,
  opensAt: row.opens_at,
  closesAt: row.closes_at,
  ...(row.started_by ? { startedBy: row.started_by } : {}),
  ...(row.closed_at ? { closedAt: row.closed_at } : {}),
  ...(row.elder_entrance !== null && row.elder_resident_id
    ? { elder: { entrance: row.elder_entrance, residentId: row.elder_resident_id } }
    : {}),
  ...(row.mode === 'survey' ? { mode: 'survey' as const } : { mode: 'meeting' as const }),
  ...(row.notice_id ? { noticeId: row.notice_id } : {}),
  ...(row.protocol_id ? { protocolId: row.protocol_id } : {}),
});
