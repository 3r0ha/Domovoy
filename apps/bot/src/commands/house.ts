import {
  apartmentsOf,
  contactsFor,
  devicesFor,
  formatContacts,
  escalationFor,
  formatQualityShort,
  houseQuality,
  listInitiativesFor,
  listPollsFor,
  listRequestsFor,
  pollProtocol,
  servedBy,
} from '@domovoy/app';
import { DomainError, isCompanyStaff, sectionParam } from '@domovoy/domain';

import { speak } from '../i18n.js';
import {
  afterError,
  appRow,
  cancelKeyboard,
  doorKeyboard,
  errorText,
  keyboardOf,
  menuButton,
  oneKeyboard,
} from '../keyboards.js';
import { expect, inChat, strong } from '../max.js';
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
    const t = speak(resident);

    try {
      const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;
      const devices = await devicesFor(deps, resident, apartment?.entrance);
      const openable = devices.filter((device) => device.kind !== 'camera');
      const cameras = devices.filter((device) => device.kind === 'camera');

      if (openable.length === 0 && cameras.length === 0) {
        await typed.reply(t('door.none'), menuButton(typed, t));
        return;
      }

      await typed.reply(
        cameras.length > 0 ? t('door.what_cameras') : t('door.what'),
        doorKeyboard(openable, cameras, undefined, t),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error, t), afterError(error, typed, t));
    }
  },

  /** Собрания собственников. */
  vote: async (typed) => {
    const resident = await residentOf(typed);
    const t = speak(resident);
    const polls = await listPollsFor(deps, resident);
    const open = polls.filter((view) => view.open);
    const collecting = (await listInitiativesFor(deps, resident)).filter((view) => !view.initiative.pollId);

    if (open.length === 0 && collecting.length === 0) {
      const [last] = polls.filter((view) => view.poll.closedAt);

      if (!last) {
        await typed.reply(t('vote.none'), menuButton(typed, t));
        return;
      }

      await typed.reply(
        shorten(await pollProtocol(deps, resident, last.poll.id), t('vote.protocol_in_app')),
        keyboardOf([...appRow(kit.miniAppUrl, t('button.polls_in_app'), 'polls', t)], typed, t),
      );
      return;
    }

    // Собрание это бюллетень с вопросами, долями и кворумом: в переписке его
    // не читают. В боте остаётся строка о том, что идёт, а голосуют на экране.
    const said = [
      open.length > 0 ? t('vote.open', { сколько: open.length }) : '',
      collecting.length > 0 ? t('vote.initiatives', { сколько: collecting.length }) : '',
    ]
      .filter(Boolean)
      .join(', ');

    await inApp(kit, typed, `${strong(t('vote.title'))}\n${said}.`, 'polls', t('button.vote'), t);
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
    const t = speak(resident);

    try {
      const short = formatQualityShort(await houseQuality(deps, resident), t);

      await inApp(kit, typed, short, 'quality', t('button.quality_in_app'), t);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error, t), afterError(error, typed, t));
    }
  },

  /** К кому обращаться по дому. */
  contacts: async (typed) => {
    const resident = await residentOf(typed);
    const t = speak(resident);

    try {
      const card = formatContacts(await contactsFor(deps, resident), t);

      // В чате дома нужен только аварийный телефон: полная карточка там читается
      // плохо и уходит вверх после пары сообщений соседей.
      const said = inChat(typed)
        ? `${card.split('\n')[0]!}\n${t('contacts.tail')}`
        : shorten(card, t('contacts.tail'));

      await typed.reply(said, openApp(sectionParam('support'), typed));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error, t), afterError(error, typed, t));
    }
  },

  /** Поддержка: вопрос жильца и переписка с управляющей компанией. */
  support: async (typed) => {
    const resident = await residentOf(typed);
    const t = speak(resident);

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

    await typed.reply(shown === 0 ? t('support.ask') : t('support.ask_more'), cancelKeyboard(t));
  },

  /** Обращение в жилинспекцию по последней просроченной заявке. */
  gzhi: async (typed) => {
    const resident = await residentOf(typed);
    const t = speak(resident);

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
          t('gzhi.sent_already', { номер: request.number, организация: offer.sent.organization }) +
            `${offer.sent.externalId ? ` ${t('gzhi.number', { номер: offer.sent.externalId })}` : ''}`,
          menuButton(typed, t),
        );
        return;
      }

      await typed.reply(t('gzhi.reason', { номер: request.number, основание: offer.reason }));
      await typed.reply(offer.complaint, oneKeyboard(t('button.complaint'), `gzhi:${request.id}:send`));
      return;
    }

    await typed.reply(t('gzhi.none'), menuButton(typed, t));
    },
  };
};
