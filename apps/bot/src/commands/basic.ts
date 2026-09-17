import {
  apartmentsOf,
  demoRoles,
  exportPersonalData,
  formatPersonalData,
  personalDataSummary,
  listOwnApartments,
  zoneOf,
} from '@domovoy/app';

import { cancelKeyboard, dataKeyboard, demoKeyboard, flatKeyboard, flatTitle, menuButton } from '../keyboards.js';
import { expect, inChat } from '../max.js';
import { showRequests } from '../pages.js';
import type { BotKit, Handler } from '../kit.js';

/** Сколько строк выгрузки ещё читаются прямо в переписке. */
const SHORT_DATA_LINES = 12;

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

  /** Выгрузка своих данных: право знать о себе есть и у того, кто не открывал приложение. */
  mydata: async (typed) => {
    const resident = await kit.residentOf(typed);
    const data = await exportPersonalData(kit.deps, resident);
    const text = formatPersonalData(data, await zoneOf(kit.deps, resident.buildingId));
    const keyboard = dataKeyboard(apartmentsOf(resident).length > 0, typed);

    // Короткая выгрузка читается в переписке, длинная уходит файлом: иначе она
    // занимает несколько экранов.
    const sent =
      text.split('\n').length > SHORT_DATA_LINES && resident.maxUserId && kit.deps.notifier?.sendFile
        ? await kit.deps.notifier
            .sendFile({
              maxUserId: resident.maxUserId,
              as: 'document',
              name: 'domovoy-data.txt',
              contentType: 'text/plain; charset=utf-8',
              content: text,
              encoding: 'utf8',
              text: `Ваши данные файлом. ${personalDataSummary(data)}`,
            })
            .catch(() => undefined)
        : undefined;

    if (sent) {
      await typed.reply('Что дальше с профилем?', keyboard);
      return;
    }

    await typed.reply(text, keyboard);
  },

  flat: async (typed) => {
    const resident = await kit.residentOf(typed);
    const own = await listOwnApartments(kit.deps, resident);

    if (own.length === 0) {
      await typed.reply('Квартира ещё не привязана. Отправьте код из квитанции.', menuButton(typed));
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

    // Спросить словами проще, чем искать пункт меню: помощник ждёт вопрос,
    // а меню остаётся рядом для тех, кому привычнее кнопки.
    expect(typed, { kind: 'assistant' });

    await typed.reply(
      'Спросите словами, что нужно сделать, я подскажу и открою нужный раздел.\nИли выберите из меню.',
      kit.menuKeyboard(await kit.residentOf(typed)),
    );
  },
});
