import {
  apartmentsOf,
  demoRoles,
  exportPersonalData,
  personalDataSummary,
  listOwnApartments,
} from '@domovoy/app';

import { cancelKeyboard, dataKeyboard, demoKeyboard, flatKeyboard, flatTitle, menuButton } from '../keyboards.js';
import { startTalk } from '../talk.js';
import { expect, inChat } from '../max.js';
import { showRequests } from '../pages.js';
import type { BotKit, Handler } from '../kit.js';

/** Заявка, свои дела и справка: то, с чего начинают в личной переписке. */
export const basicCommands = (kit: BotKit): Record<string, Handler> => ({
  new: async (typed) => {
    typed.session ??= {};
    expect(typed, { kind: 'description' });

    await typed.reply(
      'Опишите, что случилось. Если знаете номер подъезда или квартиры, укажите в тексте.',
      cancelKeyboard(),
    );
  },

  my: (typed) => showRequests(kit, typed),

  /** Проверка: жюри примеряет роль, не заводя пять учётных записей MAX. */
  demo: async (typed) => {
    if (!kit.demo) {
      await typed.reply('Переключение ролей выключено.', menuButton(typed));
      return;
    }

    const resident = await kit.residentOf(typed);

    await typed.reply('Кем смотрим продукт?', demoKeyboard(demoRoles(resident)));
  },

  /**
   * Профиль: что о человеке знает продукт и что с этим можно сделать. Выгрузка
   * уходит по кнопке: файл без спроса человек не просил.
   */
  mydata: async (typed) => {
    const resident = await kit.residentOf(typed);
    const data = await exportPersonalData(kit.deps, resident);

    await typed.reply(
      `О вас: ${personalDataSummary(data)}.`,
      dataKeyboard(apartmentsOf(resident).length > 0, typed),
    );
  },

  flat: async (typed) => {
    const resident = await kit.residentOf(typed);
    const own = await listOwnApartments(kit.deps, resident);

    if (own.length === 0) {
      // Код ждут следующим сообщением: без ожидания он уходит в обращение.
      expect(typed, { kind: 'code' });

      await typed.reply('Квартира ещё не привязана. Отправьте код из квитанции.', cancelKeyboard());
      return;
    }

    if (own.length === 1) {
      await typed.reply(`Ваша ${flatTitle(own[0]!)}.`, menuButton(typed));
      return;
    }

    await typed.reply(
      `Выбрана ${flatTitle(own.find((item) => item.current) ?? own[0]!)}: по ней идут показания и квитанция.`,
      flatKeyboard(own),
    );
  },

  help: async (typed) => {
    if (inChat(typed)) {
      await typed.reply(kit.chatHelp(await kit.houseOf(typed)), kit.openApp(undefined, typed));
      return;
    }

    await startTalk(kit, typed);
  },
});
