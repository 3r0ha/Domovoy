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
  CLOSED_STATUSES,
  DomainError,
  categoryKey,
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
import type { Translate } from '@domovoy/i18n';
import { Keyboard } from '@maxkit/max-bot-api';

import { speak } from './i18n.js';
import {
  actionKeyboard,
  afterError,
  alsoKeyboard,
  assignable,
  appRow,
  errorText,
  keyboardOf,
  menuButton,
  moreKeyboard,
  oneKeyboard,
  replyIfOpen,
  supportKeyboard,
} from './keyboards.js';
import { inApp } from './commands/in-app.js';
import { inChat, strong, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Сколько строк списка помещается в одно сообщение, не заваливая переписку. */
export const PAGE = 5;

/** Сколько заявок приходит карточками: остальное открывается списком в приложении. */
const CARDS = 3;

/** Со скольких заявок список в переписке перестаёт читаться. */
const LIST_LIMIT = 2;

/** Объявление занимает несколько строк, поэтому их в сообщении меньше. */
const NEWS_PAGE = 2;

/** Сколько знаков объявления читается в переписке. */
const BODY_LIMIT = 400;

/** Длинный текст в переписке обрезается: целиком он открывается в приложении. */
const briefly = (text: string, t: Translate): string =>
  text.length <= BODY_LIMIT ? text : `${text.slice(0, BODY_LIMIT).trimEnd()}…\n${t('news.rest_in_app')}`;

/** Кто ведёт работу: имя исполнителя видно и жильцу, и смене. */
const workedBy = async (kit: BotKit, t: Translate, assigneeId?: string): Promise<string> => {
  if (!assigneeId) return '';

  const master = await kit.deps.repository.findResident(assigneeId);

  return master ? `\n${t('request.worker', { кто: master.displayName })}` : '';
};

/** Карточка заявки: суть, состояние, адрес, номер, срок и исполнитель. */
const requestCard = async (
  kit: BotKit,
  request: Awaited<ReturnType<typeof listRequestsFor>>[number],
  forStaff: boolean,
  zone: string,
  t: Translate,
): Promise<string> => {
  const due = CLOSED_STATUSES.includes(request.status)
    ? ''
    : `\n${t('request.due', { срок: formatMoment(request.resolutionDueAt, zone, t) })}`;

  return (
    `${request.title}\n` +
    `${statusTitle(request.status, forStaff, t)} · ${describePlace(request, t)}\n` +
    `${request.number}${due}${await workedBy(kit, t, request.assigneeId)}`
  );
};

/** Заявки и наряды человека. Закрытые читаются отдельным списком в приложении. */
export const showRequests = async (kit: BotKit, typed: BotContext): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);
  const requests = await listRequestsFor(kit.deps, resident, 'mine');

  if (requests.length === 0) {
    const empty =
      resident.role === 'resident'
        ? { text: t('request.none'), keyboard: oneKeyboard(t('button.new_request'), 'menu:new') }
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
      (forStaff ? `Нарядов на вас: ${requests.length}` : t('request.mine_count', { сколько: requests.length })) +
        (late > 0 ? t('request.late', { сколько: late }) : '') +
        '.',
      keyboardOf(
        [
          ...appRow(
            kit.miniAppUrl,
            forStaff ? 'Очередь в приложении' : t('button.requests_in_app'),
            forStaff ? 'queue' : 'list',
          ),
        ],
        typed,
        t,
      ),
    );

    return;
  }

  // В переписке показывается то, что требует ответа сейчас.
  const shown = requests.slice(0, CARDS);

  // Каждая заявка идёт своим сообщением: под ней кнопки перехода и «Написать».
  // Передача смежной организации стоит здесь же: раньше она была только на
  // карточке по номеру заявки, и смена до неё не доходила.
  for (const request of shown) {
    const passable =
      isCompanyStaff(resident.role) &&
      (await responsibilityOf(kit.deps, (await kit.deps.repository.findRequest(request.id))!)
        .then((view) => view.targets.length > 0)
        .catch(() => false));

    await typed.reply(
      await requestCard(kit, request, forStaff, zone, t),
      actionKeyboard(
        actionsFor(request, resident),
        replyIfOpen(request),
        assignable(request, resident.role),
        passable ? request.id : undefined,
        t,
      ),
    );
  }

  const rest = requests.length - shown.length;

  if (rest > 0) {
    await typed.reply(
      forStaff
        ? `Ещё нарядов: ${rest}. Очередь целиком в приложении.`
        : t('request.rest', { сколько: rest }),
      keyboardOf(
        [
          ...appRow(
            kit.miniAppUrl,
            forStaff ? 'Очередь в приложении' : t('button.requests_in_app'),
            forStaff ? 'queue' : 'list',
          ),
        ],
        typed,
        t,
      ),
    );

    return;
  }

  // Закрытое лежит отдельно: в переписке его не листают, оно нужно как архив.
  const closed = await listRequestsFor(kit.deps, resident, 'closed', { limit: 1 });

  if (closed.length === 0) return;

  await typed.reply(
    t('request.all_open'),
    keyboardOf([...appRow(kit.miniAppUrl, t('button.requests_in_app'), 'list')], typed, t),
  );
};

/**
 * Заявка по её номеру: человек присылает номер из уведомления или квитанции,
 * и это вопрос о заявке, а не новое обращение.
 */
export const showRequestByNumber = async (kit: BotKit, typed: BotContext, number: string): Promise<boolean> => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);
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
  const view = stored ? await responsibilityOf(kit.deps, stored, t) : undefined;
  const handoffs = stored ? await handoffsOf(kit.deps, stored.id, resident) : [];

  // Кто отвечает и кому передано, важнее прочего: с этого начинается ответ на
  // вопрос «что с моим обращением». Жильцу идёт короткая строка, как и в
  // приложении: номер статьи ему ничего не решает, а смена читает эти карточки
  // десятками, и основание ей только мешает.
  const zones = view
    ? `\n\n${t('request.answers', { кто: view.responsibility.title })}${forStaff ? '' : `\n${view.responsibility.plain}`}`
    : '';
  const passed = handoffs.map((handoff) => `\n\n${formatHandoff(handoff, now)}`).join('');

  await typed.reply(
    `${await requestCard(kit, found, forStaff, zone, t)}${zones}${passed}`,
    actionKeyboard(
      actionsFor(found, resident),
      replyIfOpen(found),
      assignable(found, resident.role),
      isCompanyStaff(resident.role) && (view?.targets.length ?? 0) > 0 ? found.id : undefined,
      t,
    ),
  );

  return true;
};

/** Объявления дома страницами. */
export const showNews = async (kit: BotKit, typed: BotContext, offset = 0): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);
  const announcements = await listAnnouncementsFor(kit.deps, resident);

  if (announcements.length === 0) {
    await typed.reply(t('news.empty'), menuButton(typed, t));
    return;
  }

  const now = kit.deps.now();
  const shown = announcements.slice(offset, offset + NEWS_PAGE);

  if (shown.length === 0) {
    await typed.reply(t('news.all'), menuButton(typed, t));
    return;
  }

  const lines = shown.map((announcement) => {
    const work = plannedWork(announcement);
    const state = work && isUnderway(work, now) ? `${t('news.underway')}, ` : '';
    const until = work
      ? `\n${t(categoryKey(work.category))}: ${state}${describeUntil(work, now, undefined, t)}`
      : '';

    return (
      `${announcement.title}, ${describeAudience(announcementAudience(announcement), t)}\n` +
      `${formatMoment(announcement.createdAt, undefined, t)}\n${briefly(announcement.body, t)}${until}`
    );
  });

  const rest = announcements.length - (offset + shown.length);

  await typed.reply(
    `${t('news.title')}\n\n${lines.join('\n\n')}`,
    rest > 0
      ? moreKeyboard('news', offset + NEWS_PAGE, t('button.more_news'))
      : keyboardOf([
          ...(inChat(typed) ? [] : [[Keyboard.button.callback(t('button.menu'), 'group:back')]]),
          ...appRow(kit.miniAppUrl, t('button.in_app_short'), 'news'),
        ], typed, t),
  );
};

/**
 * Заявки соседей по общему имуществу. Список живёт на экране: там их видно
 * разом, с адресом и сроком. В переписке остаётся строка и переход, а в чате
 * дома, где приложения может не быть, свежее обращение с кнопкой «И у меня».
 */
export const showNeighbours = async (kit: BotKit, typed: BotContext): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);
  const requests = await supportableFor(kit.deps, resident);

  if (requests.length === 0) {
    await typed.reply(t('neighbours.empty'), menuButton(typed, t));
    return;
  }

  if (inChat(typed)) {
    const [first] = requests;

    await typed.reply(
      `${first!.title}\n` +
        `${describeTarget(first!.target)} · ${plural(reportersCount(first!), 'сосед сообщил', 'соседа сообщили', 'соседей сообщили')}\n` +
        `${first!.number}`,
      alsoKeyboard(first!.id, t),
    );

    return;
  }

  await inApp(
    kit,
    typed,
    `${strong(t('neighbours.title'))}\n` +
      t('neighbours.about', {
        сколько: plural(requests.length, 'проблеме', 'проблемах', 'проблемах'),
      }),
    'list',
    t('button.show'),
    t,
  );
};

/** Вопросы жильцов страницами: ждущие ответа стоят первыми. Возвращает число показанных. */
export const showSupport = async (kit: BotKit, typed: BotContext, offset = 0): Promise<number> => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);
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
      formatTicket(card, { zone, viewerId: resident.id, now, t }),
      card.ticket.status === 'closed' ? undefined : supportKeyboard(card.ticket.id, t),
    );
  }

  if (cards.length === 0 && offset > 0) {
    await typed.reply(t('support.all'), menuButton(typed, t));
    return 0;
  }

  if (tickets.length > offset + cards.length) {
    await typed.reply(
      t('support.more'),
      keyboardOf([
        [Keyboard.button.callback(t('button.more'), `more:support:${offset + PAGE}`)],
        ...appRow(kit.miniAppUrl, t('button.in_app_short'), 'support'),
      ], typed, t),
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
    await typed.reply(errorText(error), afterError(error, typed));
  }
};
