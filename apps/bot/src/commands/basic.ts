import {
  apartmentsOf,
  demoRoles,
  exportPersonalData,
  needsApartment,
  personalDataSummary,
  listOwnApartments,
} from '@domovoy/app';

import { speak } from '../i18n.js';
import { cancelKeyboard, dataKeyboard, demoKeyboard, flatKeyboard, flatTitle, menuButton } from '../keyboards.js';
import { startTalk } from '../talk.js';
import { expect, inChat } from '../max.js';
import { showRequests } from '../pages.js';
import type { BotKit, Handler } from '../kit.js';

/** Заявка, свои дела и справка: то, с чего начинают в личной переписке. */
export const basicCommands = (kit: BotKit): Record<string, Handler> => ({
  new: async (typed) => {
    const t = speak(await kit.residentOf(typed));

    typed.session ??= {};
    expect(typed, { kind: 'description' });

    await typed.reply(t('request.new_ask'), cancelKeyboard(t));
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
    const t = speak(resident);
    const data = await exportPersonalData(kit.deps, resident);

    // Человеку нужно узнать себя: имя и адрес, а не одни числа записей.
    const who = [data.displayName, data.address, data.apartment ? t('flat.short', { номер: data.apartment }) : undefined]
      .filter(Boolean)
      .join(', ');

    await typed.reply(
      t('data.about', { кто: who, что: personalDataSummary(data, t) }),
      dataKeyboard(apartmentsOf(resident).length > 0, typed, t),
    );
  },

  flat: async (typed) => {
    const resident = await kit.residentOf(typed);
    const t = speak(resident);
    const own = await listOwnApartments(kit.deps, resident);

    if (own.length === 0) {
      // Код ждут следующим сообщением: без ожидания он уходит в обращение.
      expect(typed, { kind: 'code' });

      await typed.reply(t('flat.unknown'), cancelKeyboard(t));
      return;
    }

    if (own.length === 1) {
      // Квартира может быть указана чужая: исправить это надо прямо отсюда.
      await typed.reply(t('flat.yours', { квартира: flatTitle(own[0]!, t) }), flatKeyboard(own, t));
      return;
    }

    await typed.reply(
      t('flat.chosen', { квартира: flatTitle(own.find((item) => item.current) ?? own[0]!, t) }),
      flatKeyboard(own, t),
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

      await typed.reply(speak(resident)('help.bind'), kit.menuKeyboard(resident));
      return;
    }

    await startTalk(kit, typed);
  },
});
