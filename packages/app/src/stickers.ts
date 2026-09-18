import {
  DEFAULT_STICKER_STYLE,
  DomainError,
  STICKER_STYLES,
  cleanStickerNote,
  isCompanyStaff,
  isStickerStyle,
  planStickers,
  plural,
  stickerFileName,
  type StickerLook,
  type StickerPlan,
  type StickerStyleName,
} from '@domovoy/domain';

import { assertServes, homeBuildingOf } from './buildings.js';
import type { OutgoingFile } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Рисование наклейки: код, подпись объекта и своя надпись. */
export interface StickerRenderer {
  svg(plan: StickerPlan, look?: StickerLook): string;
  /**
   * Картинка для ленты чата в base64. Без неё наклейка уходит разметкой: её
   * видно не в каждом клиенте, зато она не зависит от отрисовки в растр.
   */
  png?(plan: StickerPlan, look?: StickerLook): Promise<string>;
  /** Лист для печати: все коды дома на одной странице. */
  sheet?(address: string, plans: readonly StickerPlan[], look?: StickerLook): string;
}

/** Имя бота, когда его не задали: ссылки наклеек ведут в переписку с ним. */
export const DEFAULT_BOT_NAME = 'uk_bot';

/** Стиль на выбор: название и цвета для образца. */
export interface StickerStyleView {
  name: StickerStyleName;
  title: string;
  paper: string;
  ink: string;
  accent: string;
}

/** Стили наклейки для выбора в приложении и боте. */
export const stickerStyles = (): StickerStyleView[] =>
  Object.entries(STICKER_STYLES).map(([name, style]) => ({
    name: name as StickerStyleName,
    title: style.title,
    paper: style.paper,
    ink: style.ink,
    accent: style.accent,
  }));

/** Стиль по имени: неизвестное имя, это классика, а не отказ. */
export const styleOf = (name: string | undefined): StickerStyleName =>
  name && isStickerStyle(name) ? name : DEFAULT_STICKER_STYLE;

/** Объекты, на которые человек может сделать наклейку. @throws {DomainError} */
export const stickersFor = async (
  deps: AppDeps,
  resident: Resident,
  buildingId?: string,
): Promise<StickerPlan[]> => {
  const staff = isCompanyStaff(resident.role);

  // Наклейки клеят на объекты дома: это дело управляющей организации и жильца.
  // Подрядчику отвечаем отказом по правам, а не пустым списком.
  if (!staff && resident.role !== 'resident') {
    throw new DomainError('forbidden', 'Наклейки делают жильцы и сотрудники управляющей организации');
  }

  const house = buildingId ?? (staff ? (resident.buildingId ?? deps.defaultBuildingId) : await homeBuildingOf(deps, resident));

  await assertServes(deps, resident, house);

  const apartments = await deps.repository.listApartments(house);
  const equipment = await deps.repository.listEquipment(house);

  const all = planStickers({
    botName: deps.botName ?? DEFAULT_BOT_NAME,
    buildingId: house,
    apartments,
    equipment: equipment.map((item) => ({ code: item.code, title: item.title })),
    withApartments: true,
  });

  if (staff) return all;

  const own = apartments.find((apartment) => apartment.id === resident.apartmentId);

  return all.filter((plan) => {
    const { target } = plan;

    if (target.kind === 'equipment') return true;
    if (target.kind === 'apartment') return target.apartmentId === own?.id;
    if (target.kind === 'entrance') return target.entrance === own?.entrance;
    if (target.kind === 'riser') return target.entrance === own?.entrance && target.riser === own.riser;

    return false;
  });
};

/** Наклейка объекта с проверкой права её делать. @throws {DomainError} */
export const stickerFor = async (
  deps: AppDeps,
  resident: Resident,
  payload: string,
  buildingId?: string,
): Promise<StickerPlan> => {
  const plan = (await stickersFor(deps, resident, buildingId)).find((item) => item.payload === payload);

  if (!plan) throw new DomainError('wrong_object', 'Наклейку этого объекта здесь не сделать');

  return plan;
};

/** Готовая наклейка картинкой. @throws {DomainError} */
export const drawSticker = async (
  deps: AppDeps,
  resident: Resident,
  payload: string,
  look: StickerLook = {},
): Promise<{ plan: StickerPlan; svg: string }> => {
  if (!deps.stickers) throw new DomainError('stickers_unavailable', 'Рисование наклеек не настроено');

  const plan = await stickerFor(deps, resident, payload);

  return { plan, svg: deps.stickers.svg(plan, { ...look, style: styleOf(look.style) }) };
};

export interface SendStickerCommand {
  resident: Resident;
  payload: string;
  style?: string;
  note?: string;
  /**
   * Картинку смотрят и пересылают прямо в ленте, файл сохраняют и печатают.
   * По умолчанию уходит картинка, а без отрисовки в растр, разметка файлом.
   */
  as?: 'image' | 'document';
}

export interface SentSticker {
  plan: StickerPlan;
  /** Идентификатор сообщения: по нему приложение пересылает наклейку дальше. */
  messageId?: string;
  /** Чем ушла наклейка: картинкой или файлом. */
  as: 'image' | 'document';
}

/** Наклейка уходит человеку в переписку: оттуда её пересылают и сохраняют. @throws {DomainError} */
export const sendSticker = async (deps: AppDeps, command: SendStickerCommand): Promise<SentSticker> => {
  const { resident } = command;
  const note = cleanStickerNote(command.note);
  const look = { style: styleOf(command.style), ...(note ? { note } : {}) };
  const { plan, svg } = await drawSticker(deps, resident, command.payload, look);
  const png = command.as === 'document' ? undefined : await deps.stickers?.png?.(plan, look);

  const messageId = await sendFileTo(deps, resident, {
    as: png ? 'image' : 'document',
    name: stickerFileName(plan, png ? 'png' : 'svg'),
    contentType: png ? 'image/png' : 'image/svg+xml',
    content: png ?? svg,
    encoding: png ? 'base64' : 'utf8',
    text: note ? `${plan.caption}\n${note}` : plan.caption,
  });

  return { plan, as: png ? 'image' : 'document', ...(messageId ? { messageId } : {}) };
};

/** Лист для печати: все коды дома на одной странице. @throws {DomainError} */
export const stickerSheet = async (
  deps: AppDeps,
  resident: Resident,
  buildingId?: string,
): Promise<{ html: string; address: string; count: number }> => {
  if (!isCompanyStaff(resident.role)) {
    throw new DomainError('forbidden', 'Наклейки на весь дом печатает управляющая компания');
  }

  if (!deps.stickers?.sheet) throw new DomainError('stickers_unavailable', 'Рисование наклеек не настроено');

  const plans = await stickersFor(deps, resident, buildingId);
  const house = buildingId ?? resident.buildingId ?? deps.defaultBuildingId;
  const building = await deps.repository.findBuilding(house);
  const address = building?.address ?? '';

  return { html: deps.stickers.sheet(address, plans), address, count: plans.length };
};

/** Лист для печати уходит файлом в переписку: оттуда его открывают и печатают. @throws {DomainError} */
export const sendStickerSheet = async (
  deps: AppDeps,
  resident: Resident,
  buildingId?: string,
): Promise<{ address: string; count: number; messageId?: string }> => {
  const sheet = await stickerSheet(deps, resident, buildingId);

  const messageId = await sendFileTo(deps, resident, {
    as: 'document',
    name: `Наклейки, ${sheet.address || 'дом'}.html`,
    contentType: 'text/html',
    content: sheet.html,
    encoding: 'utf8',
    text: `Наклейки дома: ${plural(sheet.count, 'код', 'кода', 'кодов')} на одной странице.`,
  });

  return { address: sheet.address, count: sheet.count, ...(messageId ? { messageId } : {}) };
};

/** Файл уходит в переписку с ботом тому, кто его попросил. @throws {DomainError} */
const sendFileTo = async (
  deps: AppDeps,
  resident: Resident,
  file: Omit<OutgoingFile, 'maxUserId'>,
): Promise<string | undefined> => {
  if (!resident.maxUserId) {
    throw new DomainError('user_unknown', 'Некуда отправить: профиль без учётной записи MAX');
  }

  const notifier = deps.notifier;

  if (!notifier?.sendFile) throw new DomainError('stickers_unavailable', 'Отправка файлов не настроена');

  return notifier.sendFile({ maxUserId: resident.maxUserId, ...file });
};
