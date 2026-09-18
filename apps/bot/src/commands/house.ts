import {
  apartmentsOf,
  contactsFor,
  devicesFor,
  formatContacts,
  escalationFor,
  formatPollResult,
  formatQualityShort,
  houseQuality,
  listInitiativesFor,
  listPollsFor,
  listRequestsFor,
  pollProtocol,
  servedBy,
} from '@domovoy/app';
import { DomainError, isCompanyStaff, sectionParam } from '@domovoy/domain';

import {
  afterError,
  appRow,
  cancelKeyboard,
  doorKeyboard,
  errorText,
  formatInitiative,
  initiativeKeyboard,
  keyboardOf,
  menuButton,
  oneKeyboard,
  pollRow,
} from '../keyboards.js';
import { expect, inChat } from '../max.js';
import { showNeighbours, showNews, showSupport } from '../pages.js';
import { inApp, shorten } from './in-app.js';
import type { BotKit, Handler } from '../kit.js';

/** Дела дома: двери, собрания, объявления, соседи и работа компании. */
export const houseCommands = (kit: BotKit): Record<string, Handler> => {
  const { deps, residentOf, openApp } = kit;

  return {
  /** Открытие домофона из переписки. */
  door: async (typed) => {
    const resident = await residentOf(typed);

    try {
      const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;
      const devices = await devicesFor(deps, resident, apartment?.entrance);
      const openable = devices.filter((device) => device.kind !== 'camera');
      const cameras = devices.filter((device) => device.kind === 'camera');

      if (openable.length === 0 && cameras.length === 0) {
        await typed.reply('Домофон к дому не подключён. Управляющая компания добавит его в приложении.', menuButton(typed));
        return;
      }

      await typed.reply(
        cameras.length > 0 ? 'Что открыть или посмотреть?' : 'Что открыть?',
        doorKeyboard(openable, cameras),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error), afterError(error, typed));
    }
  },

  /** Собрания собственников. */
  vote: async (typed) => {
    const resident = await residentOf(typed);
    const polls = await listPollsFor(deps, resident);
    const open = polls.filter((view) => view.open);
    const collecting = (await listInitiativesFor(deps, resident)).filter((view) => !view.initiative.pollId);

    if (open.length === 0 && collecting.length === 0) {
      const [last] = polls.filter((view) => view.poll.closedAt);

      if (!last) {
        await typed.reply(
          'Открытых собраний сейчас нет.\n' +
            'Здесь появятся собрания собственников: голос подают кнопкой, решение считают по площади квартир.',
          menuButton(typed),
        );
        return;
      }

      await typed.reply(
        shorten(await pollProtocol(deps, resident, last.poll.id), 'Протокол целиком в приложении.'),
        keyboardOf([...appRow(kit.miniAppUrl, 'Собрания в приложении', 'polls')], typed),
      );
      return;
    }

    // Собраний бывает несколько разом, у каждого свои доли и кворум. Бюллетень
    // приходит уведомлением по каждому, а списком их читают на экране.
    if (open.length > 1 || collecting.length > 1) {
      const said = [
        open.length > 0 ? `Открытых собраний: ${open.length}` : '',
        collecting.length > 0 ? `предложений соседей: ${collecting.length}` : '',
      ]
        .filter(Boolean)
        .join(', ');

      await inApp(kit, typed, `${said}.`, 'polls', 'Собрания в приложении');
      return;
    }

    // Одно собрание остаётся в переписке: проголосовать можно тут же.
    for (const view of open) {
      await typed.reply(
        shorten(formatPollResult(view, { personal: !inChat(typed) }), 'Счёт голосов в приложении.'),
        keyboardOf([pollRow(view.poll.id), ...appRow(kit.miniAppUrl, 'Собрание в приложении', 'polls')], typed),
      );
    }

    for (const view of collecting) {
      await typed.reply(formatInitiative(view), view.mine ? undefined : initiativeKeyboard(view.initiative.id));
    }
  },

  news: (typed) => showNews(kit, typed),

  /** Заявки соседей по общему имуществу: их поддерживают кнопкой «И у меня». */
  neighbours: (typed) => showNeighbours(kit, typed),

  /**
   * Работа компании: в переписке одна строка, а разрезы по категориям,
   * сравнение с прошлым периодом и оценки жильцов, это экран.
   */
  house: async (typed) => {
    const resident = await residentOf(typed);

    try {
      const short = formatQualityShort(await houseQuality(deps, resident));

      await inApp(kit, typed, short, 'quality', 'Работа дома в приложении');
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error), afterError(error, typed));
    }
  },

  /** К кому обращаться по дому. */
  contacts: async (typed) => {
    const resident = await residentOf(typed);

    try {
      const card = formatContacts(await contactsFor(deps, resident));

      // В чате дома нужен только аварийный телефон: полная карточка там читается
      // плохо и уходит вверх после пары сообщений соседей.
      const said = inChat(typed)
        ? `${card.split('\n')[0]!}\nОстальные контакты в приложении.`
        : shorten(card, 'Остальные контакты в приложении.');

      await typed.reply(said, openApp(sectionParam('support'), typed));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error), afterError(error, typed));
    }
  },

  /** Поддержка: вопрос жильца и переписка с управляющей компанией. */
  support: async (typed) => {
    const resident = await residentOf(typed);

    const shown = await showSupport(kit, typed);

    // Сотрудник отвечает жильцам, но и сам живёт в квартире: свой вопрос он
    // задаёт отдельной кнопкой, чтобы он не смешался с чужими.
    if (isCompanyStaff(resident.role)) {
      if (apartmentsOf(resident).length > 0) {
        await typed.reply('Свой вопрос в управляющую компанию задаётся отдельно.', oneKeyboard('✉️ Свой вопрос', 'support:own'));
      }

      return;
    }

    typed.session ??= {};
    expect(typed, { kind: 'support' });

    await typed.reply(
      shown === 0
        ? 'Напишите вопрос одним сообщением, передам управляющей компании.'
        : 'Новый вопрос напишите одним сообщением, а к прежнему ответьте кнопкой.',
      cancelKeyboard(),
    );
  },

  /** Обращение в жилинспекцию по последней просроченной заявке. */
  gzhi: async (typed) => {
    const resident = await residentOf(typed);

    // Наряды подрядчика чужие: обращаться по ним в инспекцию ему не с чем.
    if (resident.role === 'contractor') {
      await typed.reply('Обращение в жилищную инспекцию составляет заявитель, а не исполнитель наряда.', menuButton(typed));
      return;
    }

    const served = new Set(servedBy(resident, deps));
    const mine = await listRequestsFor(deps, resident, 'mine');
    const own = mine.filter((request) => !isCompanyStaff(resident.role) || !served.has(request.buildingId));

    if (own.length === 0 && isCompanyStaff(resident.role)) {
      await typed.reply('Обращение в жилищную инспекцию составляет заявитель, а не управляющая компания.', menuButton(typed));
      return;
    }

    for (const request of own) {
      // Наряд подрядчика чужой: обращение по нему составляет заявитель, а не исполнитель.
      const offer = await escalationFor(deps, resident, request.id).catch((error: unknown) => {
        if (error instanceof DomainError) return undefined;

        throw error;
      });

      if (!offer?.possible || !offer.complaint) continue;

      if (offer.sent) {
        await typed.reply(
          `Обращение по заявке ${request.number} уже отправлено: ${offer.sent.organization}.` +
            `${offer.sent.externalId ? ` Номер ${offer.sent.externalId}.` : ''}`,
          menuButton(typed),
        );
        return;
      }

      await typed.reply(
        `По заявке ${request.number} есть основание для обращения: ${offer.reason}.\n` +
          'Вот текст обращения, прочитайте его. Отправлю сам, по кнопке.',
      );
      await typed.reply(offer.complaint, oneKeyboard('📨 Отправить в инспекцию', `gzhi:${request.id}:send`));
      return;
    }

    await typed.reply('Нарушенных сроков по вашим заявкам нет, обращаться не с чем.', menuButton(typed));
    },
  };
};
