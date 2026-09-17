import type { Announcement, Building, Resident } from '@domovoy/app';
import type {
  Apartment,
  Attachment,
  Handoff,
  RequestCategory,
  RequestEvent,
  RequestJoin,
  RequestTarget,
  ServiceRequest,
  Visit,
} from '@domovoy/domain';

export interface ResidentRow {
  id: string;
  max_user_id: string | null;
  display_name: string;
  role: Resident['role'];
  building_id: string | null;
  apartment_id: string | null;
  apartment_ids: string[] | null;
  on_duty: boolean | null;
  forgotten_at: Date | null;
  mutes: string[] | null;
  phone: string | null;
  serves_building_ids: string[] | null;
  legal_version: string | null;
  legal_at: Date | null;
}

export interface RequestRow {
  id: string;
  number: string;
  building_id: string;
  author_id: string;
  assignee_id: string | null;
  category: ServiceRequest['category'];
  priority: ServiceRequest['priority'];
  status: ServiceRequest['status'];
  description: string;
  target_kind: string;
  apartment_id: string | null;
  apartment_number: number | null;
  entrance: number | null;
  riser: number | null;
  equipment_code: string | null;
  equipment_title: string | null;
  created_at: Date;
  reaction_due_at: Date;
  resolution_due_at: Date;
  reopen_count: number | null;
  rating: number | null;
  knocked_at: Date | null;
  title: string;
}

export interface ApartmentRow {
  id: string;
  building_id: string;
  code: string | null;
  number: number;
  entrance: number;
  riser: number;
  area: string | null;
  residents: number | null;
}

export const toApartment = (row: ApartmentRow): Apartment => ({
  id: row.id,
  buildingId: row.building_id,
  ...(row.code === null ? {} : { code: row.code }),
  number: row.number,
  entrance: row.entrance,
  riser: row.riser,
  ...(row.area === null ? {} : { area: Number(row.area) }),
  ...(row.residents === null ? {} : { residents: row.residents }),
});

export interface EventRow {
  id: string;
  request_id: string;
  assignee_id: string | null;
  status: ServiceRequest['status'];
  role: Resident['role'];
  actor_id: string;
  comment: string | null;
  is_message: boolean;
  on_site: boolean;
  at: Date;
}

export const toResident = (row: ResidentRow): Resident => ({
  id: row.id,
  ...(row.max_user_id === null ? {} : { maxUserId: Number(row.max_user_id) }),
  displayName: row.display_name,
  role: row.role,
  ...(row.apartment_id ? { apartmentId: row.apartment_id } : {}),
  ...(row.apartment_ids && row.apartment_ids.length > 0 ? { apartmentIds: row.apartment_ids } : {}),
  ...(row.building_id ? { buildingId: row.building_id } : {}),
  ...(row.on_duty === true ? { onDuty: true } : {}),
  ...(row.forgotten_at ? { forgottenAt: row.forgotten_at } : {}),
  ...(row.mutes && row.mutes.length > 0 ? { mutes: row.mutes as Resident['mutes'] } : {}),
  ...(row.phone ? { phone: row.phone } : {}),
  ...(row.serves_building_ids && row.serves_building_ids.length > 0
    ? { servesBuildingIds: row.serves_building_ids }
    : {}),
  ...(row.legal_version ? { legalVersion: row.legal_version } : {}),
  ...(row.legal_at ? { legalAt: row.legal_at } : {}),
});

export const toTarget = (row: RequestRow): RequestTarget => {
  switch (row.target_kind) {
    case 'apartment':
      return {
        kind: 'apartment',
        apartmentId: row.apartment_id ?? '',
        ...(row.apartment_number === null ? {} : { number: Number(row.apartment_number) }),
      };
    case 'entrance':
      return { kind: 'entrance', buildingId: row.building_id, entrance: row.entrance ?? 0 };
    case 'riser':
      return { kind: 'riser', buildingId: row.building_id, entrance: row.entrance ?? 0, riser: row.riser ?? 0 };
    case 'equipment':
      return {
        kind: 'equipment',
        buildingId: row.building_id,
        equipmentId: row.equipment_code ?? '',
        ...(row.equipment_title === null ? {} : { title: row.equipment_title }),
      };
    default:
      return { kind: 'building', buildingId: row.building_id };
  }
};

/** Разложение объекта заявки по колонкам: в запросе он один, полей несколько. */
export const fromTarget = (target: RequestTarget) => ({
  kind: target.kind,
  apartmentId: target.kind === 'apartment' ? target.apartmentId : null,
  apartmentNumber: target.kind === 'apartment' ? (target.number ?? null) : null,
  entrance: target.kind === 'entrance' || target.kind === 'riser' ? target.entrance : null,
  riser: target.kind === 'riser' ? target.riser : null,
  equipmentCode: target.kind === 'equipment' ? target.equipmentId : null,
  equipmentTitle: target.kind === 'equipment' ? (target.title ?? null) : null,
});

/** Ответы соседей по одной заявке, разложенные по смыслу. */
export interface Answers {
  joinedBy: RequestJoin[];
  notAffected: RequestJoin[];
}

export const NO_ANSWERS: Answers = { joinedBy: [], notAffected: [] };

export const toRequest = (
  row: RequestRow,
  history: RequestEvent[],
  answers: Answers = NO_ANSWERS,
  attachments: Attachment[] = [],
): ServiceRequest => ({
  id: row.id,
  number: row.number,
  buildingId: row.building_id,
  authorId: row.author_id,
  category: row.category,
  priority: row.priority,
  status: row.status,
  title: row.title,
  description: row.description,
  target: toTarget(row),
  createdAt: row.created_at,
  reactionDueAt: row.reaction_due_at,
  resolutionDueAt: row.resolution_due_at,
  ...(row.assignee_id ? { assigneeId: row.assignee_id } : {}),
  history,
  joinedBy: answers.joinedBy,
  notAffected: answers.notAffected,
  attachments,
  reopenCount: row.reopen_count ?? 0,
  ...(row.rating === null ? {} : { rating: row.rating }),
  ...(row.knocked_at ? { knockedAt: row.knocked_at } : {}),
});

export interface BuildingRow {
  id: string;
  code: string;
  address: string;
  management_company: string | null;
  company_id: string | null;
  time_zone: string | null;
  chat_id: string | number | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  emergency_phone: string | null;
  company_phone: string | null;
  company_email: string | null;
  work_hours: string | null;
  office_address: string | null;
  office_hours: string | null;
  reception: string | null;
  visit_minutes: number | null;
  partners: unknown;
}

/** Ответственный по дому лежит колонками: своей таблицы на четыре поля не нужно. */
const toContact = (row: BuildingRow): { contact?: Building['contact'] } =>
  row.contact_name === null
    ? {}
    : {
        contact: {
          name: row.contact_name,
          ...(row.contact_role === null ? {} : { role: row.contact_role }),
          ...(row.contact_phone === null ? {} : { phone: row.contact_phone }),
          ...(row.contact_email === null ? {} : { email: row.contact_email }),
        },
      };

/** Сведения об обслуживании: пустые колонки означают, что их не заполняли. */
const toService = (row: BuildingRow): { service?: Building['service'] } => {
  const service = {
    ...(row.emergency_phone === null ? {} : { emergencyPhone: row.emergency_phone }),
    ...(row.company_phone === null ? {} : { phone: row.company_phone }),
    ...(row.company_email === null ? {} : { email: row.company_email }),
    ...(row.work_hours === null ? {} : { hours: row.work_hours }),
    ...(row.office_address === null ? {} : { office: row.office_address }),
    ...(row.office_hours === null ? {} : { officeHours: row.office_hours }),
  };

  return Object.keys(service).length > 0 ? { service } : {};
};

/** Приёмные окна лежат строкой JSON: их читают целиком и целиком переписывают. */
const toReception = (row: BuildingRow): Pick<Building, 'reception' | 'visitMinutes'> => ({
  ...(row.reception === null ? {} : { reception: JSON.parse(row.reception) as Building['reception'] }),
  ...(row.visit_minutes === null ? {} : { visitMinutes: Number(row.visit_minutes) }),
});

/** Смежные организации лежат одним полем: их список меняется целиком. */
const toPartners = (row: BuildingRow): Pick<Building, 'partners'> =>
  row.partners === null || row.partners === undefined ? {} : { partners: row.partners as Building['partners'] };

export const toBuilding = (row: BuildingRow): Building => ({
  id: row.id,
  code: row.code,
  address: row.address,
  ...(row.management_company === null ? {} : { managementCompany: row.management_company }),
  ...(row.company_id === null ? {} : { companyId: row.company_id }),
  ...(row.time_zone === null ? {} : { timeZone: row.time_zone }),
  ...(row.chat_id === null ? {} : { chatId: Number(row.chat_id) }),
  ...toContact(row),
  ...toService(row),
  ...toReception(row),
  ...toPartners(row),
});

export interface HandoffRow {
  id: string;
  request_id: string;
  building_id: string;
  target: string;
  organization: string;
  channel: string;
  external_id: string | null;
  status: string;
  due_at: Date;
  answer: string | null;
  created_at: Date;
  answered_at: Date | null;
}

export const toHandoff = (row: HandoffRow): Handoff => ({
  id: row.id,
  requestId: row.request_id,
  buildingId: row.building_id,
  to: row.target as Handoff['to'],
  organization: row.organization,
  channel: row.channel,
  status: row.status as Handoff['status'],
  dueAt: row.due_at,
  createdAt: row.created_at,
  ...(row.external_id === null ? {} : { externalId: row.external_id }),
  ...(row.answer === null ? {} : { answer: row.answer }),
  ...(row.answered_at === null ? {} : { answeredAt: row.answered_at }),
});

export interface VisitRow {
  id: string;
  building_id: string;
  resident_id: string;
  at: Date;
  minutes: number;
  topic: string;
  status: string;
  created_at: Date;
}

export const toVisit = (row: VisitRow): Visit => ({
  id: row.id,
  buildingId: row.building_id,
  residentId: row.resident_id,
  at: row.at,
  minutes: Number(row.minutes),
  topic: row.topic,
  status: row.status as Visit['status'],
  createdAt: row.created_at,
});

export interface AnnouncementRow {
  id: string;
  building_id: string;
  kind: 'building' | 'entrance' | 'riser';
  entrance: number | null;
  riser: number | null;
  title: string;
  body: string;
  created_at: Date;
  recipient_ids: string[] | null;
  works_category: RequestCategory | null;
  works_from: Date | null;
  works_until: Date | null;
  request_id: string | null;
}

export const toAnnouncement = (row: AnnouncementRow): Announcement => ({
  id: row.id,
  buildingId: row.building_id,
  audience: {
    kind: row.kind,
    ...(row.entrance === null ? {} : { entrance: row.entrance }),
    ...(row.riser === null ? {} : { riser: row.riser }),
  },
  title: row.title,
  body: row.body,
  createdAt: row.created_at,
  recipientIds: row.recipient_ids ?? [],
  ...(row.works_category && row.works_from && row.works_until
    ? { works: { category: row.works_category, from: row.works_from, until: row.works_until } }
    : {}),
  ...(row.request_id === null ? {} : { requestId: row.request_id }),
});
