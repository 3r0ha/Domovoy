import { DomainError, type Attachment } from './types.js';

/** Что осматривают. */
export type InspectionKind =
  | 'entrance'
  | 'roof'
  | 'basement'
  | 'ventilation'
  | 'lift'
  | 'intercom'
  | 'meter_unit';

export interface InspectionRule {
  title: string;
  /** Как часто повторяется, в днях. */
  everyDays: number;
  /** Обход идёт по подъездам. */
  byEntrance: boolean;
  /** Обслуживается каждая единица оборудования отдельно. */
  byEquipment?: EquipmentKind;
  /** Что проверяют: пункты в том порядке, в каком их и обходят. */
  items: readonly string[];
}

/** Оборудование, у которого свой регламент обслуживания. */
export type EquipmentKind = 'lift' | 'intercom' | 'barrier' | 'meter_unit' | 'other';

export const INSPECTION_RULES: Readonly<Record<InspectionKind, InspectionRule>> = {
  entrance: {
    title: 'Осмотр подъезда',
    everyDays: 30,
    byEntrance: true,
    items: ['Освещение и выключатели', 'Окна и входная дверь', 'Перила и ступени', 'Почтовые ящики', 'Чистота'],
  },
  roof: {
    title: 'Осмотр кровли',
    everyDays: 90,
    byEntrance: false,
    items: ['Следы протечек', 'Водостоки и воронки', 'Ограждение кровли', 'Люки и выходы на чердак'],
  },
  basement: {
    title: 'Осмотр подвала',
    everyDays: 30,
    byEntrance: false,
    items: ['Сухость', 'Запорная арматура', 'Изоляция труб', 'Освещение', 'Двери и решётки'],
  },
  ventilation: {
    title: 'Проверка вентканалов',
    everyDays: 180,
    byEntrance: true,
    items: ['Тяга в каналах', 'Оголовки на кровле', 'Решётки в квартирах'],
  },
  lift: {
    title: 'Техобслуживание лифта',
    everyDays: 30,
    byEntrance: false,
    byEquipment: 'lift',
    items: ['Двери кабины и шахты', 'Освещение и кнопки', 'Связь с диспетчером', 'Точность остановки', 'Журнал ТО'],
  },
  intercom: {
    title: 'Обслуживание домофона',
    everyDays: 180,
    byEntrance: false,
    byEquipment: 'intercom',
    items: ['Замок и доводчик', 'Панель вызова', 'Связь с квартирами', 'Резервное питание'],
  },
  meter_unit: {
    title: 'Обслуживание узла учёта',
    everyDays: 90,
    byEntrance: false,
    byEquipment: 'meter_unit',
    items: ['Пломбы', 'Показания и передача', 'Фильтры', 'Запорная арматура'],
  },
};

export type ItemState = 'ok' | 'problem';

export interface InspectionItem {
  title: string;
  /** Пусто, до пункта ещё не дошли. */
  state?: ItemState;
  /** Что не так: у проблемы объяснение обязательно, из него выйдет заявка. */
  comment?: string;
  attachments?: Attachment[];
  at?: Date;
}

export interface Inspection {
  id: string;
  buildingId: string;
  kind: InspectionKind;
  /** Подъезд, если осмотр идёт по подъездам. */
  entrance?: number;
  /** Код оборудования, если это его плановое обслуживание. */
  equipmentCode?: string;
  /** До какого момента осмотр должен быть закончен. */
  dueAt: Date;
  createdAt: Date;
  assigneeId?: string;
  items: InspectionItem[];
  finishedAt?: Date;
  /** Мастер отсканировал наклейку объекта: обход был на месте. */
  onSite?: boolean;
  /** Заявки, заведённые по найденным недостаткам. */
  requestIds: string[];
}

export interface NewInspectionInput {
  id: string;
  buildingId: string;
  kind: InspectionKind;
  entrance?: number;
  equipmentCode?: string;
  createdAt: Date;
  assigneeId?: string;
}

/** Пустой обход: пункты берутся из правила, срок, из его периодичности. */
export const planInspection = (input: NewInspectionInput): Inspection => {
  const rule = INSPECTION_RULES[input.kind];

  return {
    id: input.id,
    buildingId: input.buildingId,
    kind: input.kind,
    ...(input.entrance === undefined ? {} : { entrance: input.entrance }),
    ...(input.equipmentCode ? { equipmentCode: input.equipmentCode } : {}),
    dueAt: new Date(input.createdAt.getTime() + rule.everyDays * 24 * 60 * 60 * 1000),
    createdAt: input.createdAt,
    ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
    items: rule.items.map((title) => ({ title })),
    requestIds: [],
  };
};

export const isFinished = (inspection: Inspection): boolean =>
  inspection.items.every((item) => item.state !== undefined);

/** Сколько пунктов уже прошли: по этому числу и видно, идёт обход или стоит. */
export const checkedCount = (inspection: Inspection): number =>
  inspection.items.filter((item) => item.state !== undefined).length;

export const isInspectionOverdue = (inspection: Inspection, now: Date): boolean =>
  !inspection.finishedAt && now.getTime() > inspection.dueAt.getTime();

export interface CheckItemInput {
  inspection: Inspection;
  index: number;
  state: ItemState;
  comment?: string;
  attachments?: Attachment[];
  at: Date;
}

/** Отметка пункта осмотра. @throws {DomainError} */
export const checkItem = (input: CheckItemInput): Inspection => {
  const { inspection, index } = input;
  const item = inspection.items[index];

  if (!item) throw new DomainError('item_not_found', 'Такого пункта в осмотре нет');

  if (inspection.finishedAt) throw new DomainError('inspection_finished', 'Осмотр уже закончен');

  const comment = input.comment?.trim();

  if (input.state === 'problem' && !comment) {
    throw new DomainError('comment_required', 'Опишите, что не так: из этого выйдет заявка');
  }

  const items = inspection.items.map((current, position) =>
    position === index
      ? {
          title: current.title,
          state: input.state,
          ...(comment ? { comment } : {}),
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          at: input.at,
        }
      : current,
  );

  const updated: Inspection = { ...inspection, items };

  return isFinished(updated) ? { ...updated, finishedAt: input.at } : updated;
};
