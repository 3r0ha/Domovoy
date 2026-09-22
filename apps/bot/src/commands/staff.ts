import {
  bindHouseChat,
  releaseHouseChat,
  buildingReport,
  formatMomentAt,
  formatReportShort,
  listRequestsFor,
  workdayFor,
  zoneOf,
  queueLine,
  setDuty,
  summariseReport,
  waitingHandoffs,
  waitingSupport,
} from '@domovoy/app';
import { BASIS, DomainError, isCompanyStaff, isHandoffOverdue } from '@domovoy/domain';
import { Keyboard } from '@maxkit/max-bot-api';

import { speak } from '../i18n.js';
import { boundHere, pinNote } from '../chat-binding.js';
import { afterError, appRow, errorText, keyboardOf, menuButton, oneKeyboard } from '../keyboards.js';
import { showDebtors } from '../pages.js';
import { inChat } from '../max.js';
import type { BotKit, Handler } from '../kit.js';

/** Сколько строк очереди читается в переписке: остальное листают на экране. */
const QUEUE_LINES = 3;

/** Сколько нарядов дня показывать в переписке. */
const DAY_LINES = 5;

/** Дела смены: сводка, долги дома и привязка чата. */
export const staffCommands = (kit: BotKit): Record<string, Handler> => {
  const { bot, deps, residentOf, openApp } = kit;

  return {
  /**
   * Очередь дома одной строкой. Листать её в переписке нечем и незачем:
   * сортировка по сроку, поиск и приём в работу живут на экране.
   */
  /**
   * Рабочий день исполнителя: наряды по порядку обхода. Наряды приходят
   * по одному сообщением, а дня целиком мастер не видел.
   */
  day: async (typed) => {
    const resident = await residentOf(typed);
    const t = speak(resident);

    try {
      const day = await workdayFor(deps, resident);

      if (day.items.length === 0) {
        await typed.reply(t('day.empty'), menuButton(typed, t));

        return;
      }

      const zone = await zoneOf(deps, resident.buildingId);
      const lines = day.items
        .slice(0, DAY_LINES)
        .map(
          (item) =>
            `${item.visitAt ? `🗓 ${formatMomentAt(item.visitAt, zone)}` : `⏳ ${formatMomentAt(item.dueAt, zone)}`}` +
            ` · ${item.number} · ${item.place}${item.overdue ? ' · просрочено' : ''}`,
        );

      const rest = day.items.length - lines.length;

      await typed.reply(
        `${t('day.title', { сколько: day.items.length, назначено: day.appointed })}\n${lines.join('\n')}` +
          (rest > 0 ? `\n${t('day.rest', { сколько: rest })}` : ''),
        keyboardOf([...appRow(kit.miniAppUrl, 'list', t), [Keyboard.button.callback(t('button.menu'), 'group:back')]]),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;

      await typed.reply(errorText(error, t), menuButton(typed, t));
    }
  },

  queue: async (typed) => {
    const resident = await residentOf(typed);

    // Очередь дома ведёт смена. Подрядчику и жильцу отвечаем про их дела, а не
    // отказом про сводку: они спрашивали не о ней.
    if (!isCompanyStaff(resident.role)) {
      const t = speak(resident);

      await typed.reply(
        resident.role === 'contractor'
          ? 'Очередь дома ведёт управляющая организация. Ваши наряды в разделе «Наряды».'
          : t('queue.resident'),
        oneKeyboard(t(resident.role === 'contractor' ? 'menu.contractor.my' : 'menu.my'), 'menu:my'),
      );

      return;
    }

    try {
      const report = await buildingReport(deps, resident);
      const { open, overdue } = report.summary;

      // Одного числа смене мало: «что горит» это первые строки очереди, где
      // видно номер, адрес и остаток времени. Остальное листают на экране.
      const queue = open === 0 ? [] : await listRequestsFor(deps, resident, 'queue').catch(() => []);
      const now = deps.now();
      const first = queue.slice(0, QUEUE_LINES).map((request) => queueLine(request, now));

      await typed.reply(
        open === 0
          ? 'Открытых заявок нет.'
          : `Открыто заявок: ${open}${overdue > 0 ? `, просрочено ${overdue}` : ''}.` +
            (first.length > 0 ? `\n\n${first.join('\n')}` : ''),
        keyboardOf([...appRow(kit.miniAppUrl, 'queue')], typed),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error), afterError(error, typed));
    }
  },

  /** Сводка по дому для сотрудника. */
  report: async (typed) => {
    const resident = await residentOf(typed);

    try {
      const report = await buildingReport(deps, resident);
      const waiting = await waitingSupport(deps, resident.buildingId ?? deps.defaultBuildingId);
      // Переданное смежным организациям идёт своим сроком: из сводки оно не пропадает.
      const passed = await waitingHandoffs(deps, resident).catch(() => []);
      const overdue = passed.filter((handoff) => isHandoffOverdue(handoff, deps.now())).length;

      await typed.reply(
        formatReportShort(report) +
          (waiting > 0 ? `\n\nВопросов без ответа: ${waiting}` : '') +
          (passed.length > 0
            ? `\nПередано и ждёт ответа: ${passed.length}${overdue > 0 ? `, просрочено ${overdue}` : ''}`
            : ''),
        keyboardOf(
          [
            ...(waiting > 0 ? [[Keyboard.button.callback('💬 Вопросы жильцов', 'menu:support')]] : []),
            ...appRow(kit.miniAppUrl, 'report'),
            ...appRow(kit.miniAppUrl, 'plan'),
          ],
          typed,
        ),
      );

      // Пересказ приходит следом: числа его не ждут, а модель отвечает секунды.
      const said = await summariseReport(report, deps.reasoner);

      if (said) await typed.reply(`${said}\n${BASIS.modelDigest}`);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error), afterError(error, typed));
    }
  },

  /**
   * Дежурство: ночью заявки уходят дежурному, а не всей смене, поэтому принять
   * и сдать его нужно оттуда, где сотрудник в эту минуту, из переписки.
   */
  duty: async (typed) => {
    const resident = await residentOf(typed);

    if (!isCompanyStaff(resident.role)) {
      await typed.reply('Дежурят сотрудники управляющей организации.', menuButton(typed));
      return;
    }

    try {
      const person = await setDuty(deps, resident, { residentId: resident.id, onDuty: !resident.onDuty });
      const back = person.onDuty ? 'Сдать дежурство' : 'Принять дежурство';
      const others = (await deps.repository.listStaff(resident.buildingId ?? deps.defaultBuildingId)).filter(
        (mate) => mate.onDuty === true && mate.id !== person.id,
      );

      const names = others.map((mate) => mate.displayName).join(', ');

      await typed.reply(
        person.onDuty
          ? `Дежурство принято: ночные заявки идут вам.${names ? ` Вместе с вами: ${names}.` : ''}`
          : `Дежурство снято.${
              names ? ` На дежурстве: ${names}.` : ' В доме никто не дежурит, ночные заявки уйдут всей смене.'
            }`,
        oneKeyboard(`🌙 ${back}`, 'menu:duty'),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error), afterError(error, typed));
    }
  },

  /** Долги дома списком, страницами. */
  debts: (typed) => showDebtors(kit, typed),

  here: async (typed) => {
    const chatId = typed.chatId;

    if (chatId === undefined || !inChat(typed)) {
      await typed.reply('Эту команду дают в чате дома: добавьте меня туда и напишите /here.', menuButton(typed));
      return;
    }

    try {
      const building = await bindHouseChat(deps, await residentOf(typed), chatId);

      await typed.reply(`${boundHere(building)}${await pinNote(bot, chatId)}`, openApp());
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error), afterError(error, typed));
    }
    },

    /** Отвязка чата дома: привязали не тот, и выгонять бота ради этого незачем. */
    unhere: async (typed) => {
      const chatId = typed.chatId;

      if (chatId === undefined || !inChat(typed)) {
        await typed.reply('Эту команду дают в том чате, который надо отвязать.', menuButton(typed));
        return;
      }

      try {
        const released = await releaseHouseChat(deps, await residentOf(typed));

        await typed.reply(
          `Чат отвязан от дома ${released.address || released.code}. Объявления сюда больше не приходят.`,
          openApp(),
        );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        await typed.reply(errorText(error), afterError(error, typed));
      }
    },
  };
};
