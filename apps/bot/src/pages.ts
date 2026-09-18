import {
  actionsFor,
  announcementAudience,
  describePlace,
  describeTickets,
  formatHandoff,
  formatTicket,
  handoffsOf,
  houseDebt,
  listSupportFor,
  listAnnouncementsFor,
  listRequestsFor,
  type RequestScope,
  plannedWork,
  formatHouseDebtShort,
  responsibilityOf,
  supportableFor,
  zoneOf,
} from '@domovoy/app';
import {
  CATEGORY_RULES,
  CLOSED_STATUSES,
  DomainError,
  describeAudience,
  describeTarget,
  describeUntil,
  formatMoment,
  isCompanyStaff,
  isUnderway,
  plural,
  reportersCount,
  statusTitle,
} from '@domovoy/domain';
import { Keyboard } from '@maxkit/max-bot-api';

import {
  actionKeyboard,
  afterError,
  alsoKeyboard,
  assignable,
  appRow,
  keyboardOf,
  menuButton,
  moreKeyboard,
  oneKeyboard,
  replyIfOpen,
  supportKeyboard,
} from './keyboards.js';
import { inChat, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Сколько строк списка помещается в одно сообщение, не заваливая переписку. */
export const PAGE = 5;

/** Сколько соседских обращений показывается в переписке: список читают на экране. */
const NEARBY = 2;

/** Сколько заявок приходит карточками: остальное открывается списком в приложении. */
const CARDS = 3;

/** Со скольких заявок список в переписке перестаёт читаться. */
const LIST_LIMIT = 2;

/** Объявление занимает несколько строк, поэтому их в сообщении меньше. */
const NEWS_PAGE = 3;

/** Кто ведёт работу: имя исполнителя видно и жильцу, и смене. */
const workedBy = async (kit: BotKit, assigneeId?: string): Promise<string> => {
  if (!assigneeId) return '';

  const master = await kit.deps.repository.findResident(assigneeId);

  return master ? `\nРаботу ведёт ${master.displayName}` : '';
};

/** Карточка заявки: суть, состояние, адрес, номер, срок и исполнитель. */
const requestCard = async (
  kit: BotKit,
  request: Awaited<ReturnType<typeof listRequestsFor>>[number],
  forStaff: boolean,
  zone: string,
): Promise<string> => {
  const due = CLOSED_STATUSES.includes(request.status)
    ? ''
    : `\nСрок: до ${formatMoment(request.resolutionDueAt, zone)}`;

  return (
    `${request.title}\n` +
    `${statusTitle(request.status, forStaff)} · ${describePlace(request)}\n` +
    `${request.number}${due}${await workedBy(kit, request.assigneeId)}`
  );
};

/** Заявки и наряды человека. Закрытые читаются отдельным списком в приложении. */
export const showRequests = async (kit: BotKit, typed: BotContext): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const requests = await listRequestsFor(kit.deps, resident, 'mine');

  if (requests.length === 0) {
    const empty =
      resident.role === 'resident'
        ? { text: 'Заявок пока нет.', keyboard: oneKeyboard('✍️ Новая заявка', 'menu:new') }
        : resident.role === 'contractor'
          ? { text: 'На вас ничего не назначено.', keyboard: menuButton(typed) }
          : { text: 'На вас ничего не назначено.', keyboard: oneKeyboard('📊 Сводка', 'menu:report') };

    await typed.reply(empty.text, empty.keyboard);
    return;
  }

  const zone = await zoneOf(kit.deps, resident.buildingId);
  const forStaff = isCompanyStaff(resident.role) || resident.role === 'contractor';

  // Длинный список в переписке не читается: вместо простыни идёт строка
  // с числами и переход в раздел, где есть поиск, фильтры и закрытые заявки.
  if (requests.length > LIST_LIMIT) {
    const late = requests.filter((request) => request.resolutionDueAt < kit.deps.now()).length;

    await typed.reply(
      (forStaff ? `Нарядов на вас: ${requests.length}` : `Ваших заявок в работе: ${requests.length}`) +
        (late > 0 ? `, просрочено ${late}` : '') +
        '.',
      keyboardOf(
        [
          ...appRow(
            kit.miniAppUrl,
            forStaff ? 'Очередь в приложении' : 'Заявки в приложении',
            forStaff ? 'queue' : 'list',
          ),
        ],
        typed,
      ),
    );

    return;
  }

  // В переписке показывается то, что требует ответа сейчас.
  const shown = requests.slice(0, CARDS);

  // Каждая заявка идёт своим сообщением: под ней кнопки перехода и «Написать».
  for (const request of shown) {
    await typed.reply(
      await requestCard(kit, request, forStaff, zone),
      actionKeyboard(actionsFor(request, resident), replyIfOpen(request), assignable(request, resident.role)),
    );
  }

  const rest = requests.length - shown.length;

  if (rest > 0) {
    await typed.reply(
      forStaff ? `Ещё нарядов: ${rest}. Очередь целиком в приложении.` : `Ещё заявок: ${rest}. Список в приложении.`,
      keyboardOf(
        [...appRow(kit.miniAppUrl, forStaff ? 'Очередь в приложении' : 'Заявки в приложении', forStaff ? 'queue' : 'list')],
        typed,
      ),
    );

    return;
  }

  // Закрытое лежит отдельно: в переписке его не листают, оно нужно как архив.
  const closed = await listRequestsFor(kit.deps, resident, 'closed', { limit: 1 });

  if (closed.length === 0) return;

  await typed.reply(
    'Это всё, что в работе. Закрытые заявки лежат в приложении.',
    keyboardOf([...appRow(kit.miniAppUrl, 'Заявки в приложении', 'list')], typed),
  );
};

/**
 * Заявка по её номеру: человек присылает номер из уведомления или квитанции,
 * и это вопрос о заявке, а не новое обращение.
 */
export const showRequestByNumber = async (kit: BotKit, typed: BotContext, number: string): Promise<boolean> => {
  const resident = await kit.residentOf(typed);
  const scopes: RequestScope[] = isCompanyStaff(resident.role) ? ['mine', 'queue', 'closed'] : ['mine', 'closed'];
  const seen = new Map<string, Awaited<ReturnType<typeof listRequestsFor>>[number]>();

  for (const scope of scopes) {
    for (const request of await listRequestsFor(kit.deps, resident, scope)) seen.set(request.number, request);
  }

  const found = seen.get(number);

  if (!found) return false;

  const zone = await zoneOf(kit.deps, resident.buildingId);
  const forStaff = isCompanyStaff(resident.role) || resident.role === 'contractor';
  const now = kit.deps.now();

  const stored = await kit.deps.repository.findRequest(found.id);
  const view = stored ? await responsibilityOf(kit.deps, stored) : undefined;
  const handoffs = stored ? await handoffsOf(kit.deps, stored.id) : [];

  // Кто отвечает и кому передано, важнее прочего: с этого начинается ответ на
  // вопрос «что с моим обращением».
  const zones = view ? `\n\nОтвечает: ${view.responsibility.title}\n${view.responsibility.basis}` : '';
  const passed = handoffs.map((handoff) => `\n\n${formatHandoff(handoff, now)}`).join('');

  await typed.reply(
    `${await requestCard(kit, found, forStaff, zone)}${zones}${passed}`,
    actionKeyboard(
      actionsFor(found, resident),
      replyIfOpen(found),
      assignable(found, resident.role),
      isCompanyStaff(resident.role) && (view?.targets.length ?? 0) > 0 ? found.id : undefined,
    ),
  );

  return true;
};

/** Объявления дома страницами. */
export const showNews = async (kit: BotKit, typed: BotContext, offset = 0): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const announcements = await listAnnouncementsFor(kit.deps, resident);

  if (announcements.length === 0) {
    await typed.reply('Объявлений пока нет.', menuButton(typed));
    return;
  }

  const now = kit.deps.now();
  const shown = announcements.slice(offset, offset + NEWS_PAGE);

  if (shown.length === 0) {
    await typed.reply('Это все объявления.', menuButton(typed));
    return;
  }

  const lines = shown.map((announcement) => {
    const work = plannedWork(announcement);
    const state = work && isUnderway(work, now) ? 'идут сейчас, ' : '';
    const until = work ? `\n${CATEGORY_RULES[work.category].title}: ${state}${describeUntil(work, now)}` : '';

    return (
      `${announcement.title}, ${describeAudience(announcementAudience(announcement))}\n` +
      `${formatMoment(announcement.createdAt)}\n${announcement.body}${until}`
    );
  });

  const rest = announcements.length - (offset + shown.length);

  await typed.reply(
    lines.join('\n\n'),
    rest > 0
      ? moreKeyboard('news', offset + NEWS_PAGE)
      : keyboardOf([
          ...(inChat(typed) ? [] : [[Keyboard.button.callback('🏠 Меню', 'group:back')]]),
          ...appRow(kit.miniAppUrl, 'В приложении', 'news'),
        ], typed),
  );
};

/** Заявки соседей по общему имуществу: их поддерживают кнопкой «И у меня». */
export const showNeighbours = async (kit: BotKit, typed: BotContext): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const requests = await supportableFor(kit.deps, resident);

  if (requests.length === 0) {
    await typed.reply('Соседи ни о чём не сообщали.', menuButton(typed));
    return;
  }

  // Список соседских обращений живёт на экране: в переписке остаётся свежее,
  // чтобы подтвердить его одной кнопкой, а остальное открывается в приложении.
  if (!inChat(typed) && requests.length > 1) {
    await typed.reply(
      `Соседи сообщили о ${requests.length} ${plural(requests.length, 'проблеме', 'проблемах', 'проблемах')}.`,
      keyboardOf([...appRow(kit.miniAppUrl, 'Заявки соседей в приложении', 'list')], typed),
    );

    return;
  }

  const shown = requests.slice(0, inChat(typed) ? 1 : NEARBY);

  for (const request of shown) {
    await typed.reply(
      `${request.title}\n` +
        `${describeTarget(request.target)} · ${plural(reportersCount(request), 'сосед сообщил', 'соседа сообщили', 'соседей сообщили')}\n` +
        `${request.number}`,
      alsoKeyboard(request.id),
    );
  }

  const rest = requests.length - shown.length;

  if (rest === 0) return;

  await typed.reply(
    kit.miniAppUrl ? `Ещё обращений соседей: ${rest}. Они списком в приложении.` : `Ещё обращений соседей: ${rest}`,
    keyboardOf([...appRow(kit.miniAppUrl, 'Заявки соседей', 'list')], typed),
  );
};

/** Вопросы жильцов страницами: ждущие ответа стоят первыми. Возвращает число показанных. */
export const showSupport = async (kit: BotKit, typed: BotContext, offset = 0): Promise<number> => {
  const resident = await kit.residentOf(typed);
  // На одну сверх страницы: по ней видно, что список не кончился.
  const tickets = await listSupportFor(kit.deps, resident, offset + PAGE + 1);
  const cards = await describeTickets(kit.deps, tickets.slice(offset, offset + PAGE));
  const zone = await zoneOf(kit.deps, resident.buildingId);
  const now = kit.deps.now();

  // Смене вопросов приходит десятками: в переписке идёт счёт и переход,
  // а разбирают их на экране, где видно, кто ждёт дольше всех.
  if (offset === 0 && isCompanyStaff(resident.role) && tickets.length > LIST_LIMIT) {
    const waiting = cards.filter((card) => card.ticket.status !== 'closed').length;

    await typed.reply(
      `Вопросов жильцов: ${tickets.length}${waiting > 0 ? `, ждут ответа ${waiting}` : ''}.`,
      keyboardOf([...appRow(kit.miniAppUrl, 'Вопросы в приложении', 'support')], typed),
    );

    return 0;
  }

  for (const card of cards) {
    await typed.reply(
      formatTicket(card, { zone, viewerId: resident.id, now }),
      card.ticket.status === 'closed' ? undefined : supportKeyboard(card.ticket.id),
    );
  }

  if (cards.length === 0 && offset > 0) {
    await typed.reply('Это все обращения.', menuButton(typed));
    return 0;
  }

  if (tickets.length > offset + cards.length) {
    await typed.reply(
      'Ещё обращения ниже.',
      keyboardOf([
        [Keyboard.button.callback('⬇️ Ещё', `more:support:${offset + PAGE}`)],
        ...appRow(kit.miniAppUrl, 'В приложении', 'support'),
      ], typed),
    );

    return cards.length;
  }

  if (cards.length === 0 && isCompanyStaff(resident.role)) {
    await typed.reply('Вопросов от жильцов нет. Как только кто-то спросит, пришлю сюда.', menuButton(typed));
  }

  return cards.length;
};

/** Долги дома страницами: смене видно, кому и сколько напоминать. */
export const showDebtors = async (kit: BotKit, typed: BotContext): Promise<void> => {
  const resident = await kit.residentOf(typed);

  try {
    const debt = await houseDebt(kit.deps, resident);
    const mayWrite = resident.role === 'dispatcher' || resident.role === 'manager';

    await typed.reply(
      formatHouseDebtShort(debt),
      debt.debtors.length === 0
        ? menuButton(typed)
        : keyboardOf(
            [
              ...(mayWrite ? [[Keyboard.button.callback('✉️ Рассылка должникам', 'cast:debtors')]] : []),
              ...appRow(kit.miniAppUrl, 'Должники в приложении', 'debtors'),
            ],
            typed,
          ),
    );
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(error.message, afterError(error, typed));
  }
};
