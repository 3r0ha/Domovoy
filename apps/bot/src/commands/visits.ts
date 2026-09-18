import { formatVisit, listVisitsFor, receptionFor, zoneOf, type Resident } from '@domovoy/app';
import { DomainError, isCompanyStaff } from '@domovoy/domain';

import { menuButton, visitCancelKeyboard, visitKeyboard } from '../keyboards.js';
import { inApp } from './in-app.js';
import { inChat } from '../max.js';
import type { BotKit, Handler } from '../kit.js';

/** Сколько ближайших часов показывать кнопками: столько же, сколько строк в списках. */
const SHOWN_SLOTS = 5;

/** Час приёма кнопкой: на подписи день недели и дата, за две недели «чт 17:30» встречается дважды. */
export interface FreeHour {
  at: string;
  title: string;
}

/**
 * Приём и его свободные часы. Часы нужны и команде, и нажатию: пока человек
 * выбирает, слот мог занять сосед, и тогда показываются свежие.
 */
export const freeHours = async (
  kit: BotKit,
  resident: Resident,
): Promise<{ reception: Awaited<ReturnType<typeof receptionFor>>; hours: FreeHour[] }> => {
  const reception = await receptionFor(kit.deps, resident);
  const zone = await zoneOf(kit.deps, reception.buildingId);

  return {
    reception,
    hours: reception.slots.slice(0, SHOWN_SLOTS).map((at) => ({
      at: at.toISOString(),
      title: at
        .toLocaleString('ru-RU', {
          timeZone: zone,
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
        .replace(/,/g, '')
        .replace(/\.$/, ''),
    })),
  };
};

/** Приём в управляющей организации: запись и отмена прямо в переписке. */
/** Сколько часов приёма ещё читаются кнопками: дальше нужен календарь. */
const NEAREST_HOURS = 6;

export const visitCommands = (kit: BotKit): Record<string, Handler> => {
  const { deps, residentOf } = kit;

  return {
    visit: async (typed) => {
      if (inChat(typed)) {
        await typed.reply('Записаться на приём можно в личной переписке со мной.');
        return;
      }

      const resident = await residentOf(typed);

      try {
        if (isCompanyStaff(resident.role)) {
          const cards = await listVisitsFor(deps, resident);

          // Сетка часов, перенос и отмена записей это календарь: в переписке
          // остаётся счёт, а ведут приём на экране.
          await inApp(
            kit,
            typed,
            cards.length === 0 ? 'Записей на приём нет.' : `Записано на приём: ${cards.length}.`,
            'visits',
            'Приём в приложении',
          );
          return;
        }

        const { reception, hours } = await freeHours(kit, resident);

        if (reception.mine) {
          await typed.reply(
            `Вы записаны на приём: ${formatVisit(reception.mine, await zoneOf(deps, reception.buildingId))}`,
            visitCancelKeyboard(reception.mine.id),
          );
          return;
        }

        if (reception.slots.length === 0) {
          await typed.reply(
            reception.windows.length === 0
              ? 'Приём по записи не ведётся. Напишите в поддержку, ответит смена.'
              : 'Свободных часов на ближайшие две недели нет.',
            menuButton(typed),
          );
          return;
        }

        // Часов на две недели вперёд десятки, и кнопками они не читаются:
        // в переписке остаются ближайшие, а весь календарь на экране.
        if (reception.slots.length > NEAREST_HOURS) {
          await inApp(
            kit,
            typed,
            `${reception.office ? `Приём: ${reception.office}.` : 'Приём по записи.'} Свободных часов: ${reception.slots.length}.`,
            'visits',
            'Выбрать время в приложении',
          );
          return;
        }

        await typed.reply(
          reception.office ? `Приём: ${reception.office}. Когда удобно?` : 'Когда удобно прийти?',
          visitKeyboard(hours),
        );
      } catch (error) {
        await typed.reply(
          error instanceof DomainError ? error.message : 'Не получилось открыть запись на приём',
          menuButton(typed),
        );
      }
    },
  };
};
