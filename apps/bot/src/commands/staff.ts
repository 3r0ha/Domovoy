import {
  bindHouseChat,
  releaseHouseChat,
  buildingReport,
  formatReportShort,
  setDuty,
  summariseReport,
  waitingHandoffs,
  waitingSupport,
} from '@domovoy/app';
import { BASIS, DomainError, isCompanyStaff, isHandoffOverdue } from '@domovoy/domain';
import { Keyboard } from '@maxkit/max-bot-api';

import { boundHere, pinNote } from '../chat-binding.js';
import { afterError, appRow, keyboardOf, menuButton, oneKeyboard } from '../keyboards.js';
import { showDebtors } from '../pages.js';
import { inChat } from '../max.js';
import type { BotKit, Handler } from '../kit.js';

/** Дела смены: сводка, долги дома и привязка чата. */
export const staffCommands = (kit: BotKit): Record<string, Handler> => {
  const { bot, deps, residentOf, openApp } = kit;

  return {
  /**
   * Очередь дома одной строкой. Листать её в переписке нечем и незачем:
   * сортировка по сроку, поиск и приём в работу живут на экране.
   */
  queue: async (typed) => {
    const resident = await residentOf(typed);

    try {
      const report = await buildingReport(deps, resident);
      const { open, overdue } = report.summary;

      await typed.reply(
        open === 0
          ? 'Открытых заявок нет.'
          : `Открыто заявок: ${open}${overdue > 0 ? `, просрочено ${overdue}` : ''}.`,
        keyboardOf([...appRow(kit.miniAppUrl, 'Очередь в приложении', 'queue')], typed),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(error.message, afterError(error, typed));
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
            ...appRow(kit.miniAppUrl, 'В приложении', 'report'),
            ...appRow(kit.miniAppUrl, 'Карта дома', 'plan'),
          ],
          typed,
        ),
      );

      // Пересказ приходит следом: числа его не ждут, а модель отвечает секунды.
      const said = await summariseReport(report, deps.reasoner);

      if (said) await typed.reply(`${said}\n${BASIS.modelDigest}`);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(error.message, afterError(error, typed));
    }
  },

  /**
   * Дежурство: ночью заявки уходят дежурному, а не всей смене, поэтому принять
   * и сдать его нужно оттуда, где сотрудник в эту минуту, из переписки.
   */
  duty: async (typed) => {
    const resident = await residentOf(typed);

    if (!isCompanyStaff(resident.role)) {
      await typed.reply('Дежурят сотрудники управляющей компании.', menuButton(typed));
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
      await typed.reply(error.message, afterError(error, typed));
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
      await typed.reply(error.message, afterError(error, typed));
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
        await typed.reply(error.message, afterError(error, typed));
      }
    },
  };
};
