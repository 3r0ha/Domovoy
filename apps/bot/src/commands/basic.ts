import {
  apartmentsOf,
  demoRoles,
  exportPersonalData,
  needsApartment,
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
      'Напишите, что случилось. Например: в подъезде 2 не горит лампочка.\n' +
        'Можно прислать фото или записать голосом.',
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

    // Человеку нужно узнать себя: имя и адрес, а не одни числа записей.
    const who = [data.displayName, data.address, data.apartment ? `кв. ${data.apartment}` : undefined]
      .filter(Boolean)
      .join(', ');

    await typed.reply(
      `${who}.\nЯ храню о вас: ${personalDataSummary(data)}.`,
      dataKeyboard(apartmentsOf(resident).length > 0, typed),
    );
  },

  flat: async (typed) => {
    const resident = await kit.residentOf(typed);
    const own = await listOwnApartments(kit.deps, resident);

    if (own.length === 0) {
      // Код ждут следующим сообщением: без ожидания он уходит в обращение.
      expect(typed, { kind: 'code' });

      await typed.reply(
        'Я пока не знаю, в какой вы квартире.\n' +
          'В квитанции напечатан код из 8 знаков рядом с адресом. Пришлите его сообщением.',
        cancelKeyboard(),
      );
      return;
    }

    if (own.length === 1) {
      // Квартира может быть указана чужая: исправить это надо прямо отсюда.
      await typed.reply(`Ваша ${flatTitle(own[0]!)}.`, flatKeyboard(own));
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

    const resident = await kit.residentOf(typed);

    // Без квартиры помощнику отвечать не о чем: справка только о привязке.
    if (needsApartment(resident)) {
      expect(typed, { kind: 'code' });

      await typed.reply(
        'Чтобы начать, пришлите код квартиры из квитанции: 8 знаков рядом с адресом.\n' +
          'После привязки здесь будут заявки, показания, квитанция и двери подъезда.',
        kit.menuKeyboard(resident),
      );
      return;
    }

    await startTalk(kit, typed);
  },
});
