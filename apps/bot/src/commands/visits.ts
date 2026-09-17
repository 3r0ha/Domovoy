import { formatVisit, listVisitsFor, receptionFor, zoneOf, type VisitCard } from '@domovoy/app';
import { DomainError, isCompanyStaff } from '@domovoy/domain';

import { menuButton, visitCancelKeyboard, visitKeyboard } from '../keyboards.js';
import { inChat } from '../max.js';
import type { BotKit, Handler } from '../kit.js';

/** Кто записан: имя и квартира, если она известна. */
const who = (card: VisitCard): string =>
  [card.residentName ?? 'Жилец', card.apartment === undefined ? '' : `кв. ${card.apartment}`]
    .filter(Boolean)
    .join(', ');

/** Сколько ближайших часов показывать кнопками: столько же, сколько строк в списках. */
const SHOWN_SLOTS = 5;

/** Приём в управляющей организации: запись и отмена прямо в переписке. */
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
          const zone = await zoneOf(deps, resident.buildingId ?? deps.defaultBuildingId);

          await typed.reply(
            cards.length === 0
              ? 'Записей на приём нет.'
              : ['Записаны на приём:', ...cards.map((card) => `${who(card)} ${formatVisit(card.visit, zone)}`)].join(
                  '\n',
                ),
            menuButton(typed),
          );
          return;
        }

        const reception = await receptionFor(deps, resident);
        const zone = await zoneOf(deps, reception.buildingId);

        if (reception.mine) {
          await typed.reply(
            `Вы записаны на приём: ${formatVisit(reception.mine, zone)}`,
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

        // На кнопке день недели и дата: за две недели «чт 17:30» встречается дважды.
        const slots = reception.slots.slice(0, SHOWN_SLOTS).map((at) => ({
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
        }));

        await typed.reply(
          reception.office ? `Приём: ${reception.office}. Когда удобно?` : 'Когда удобно прийти?',
          visitKeyboard(slots),
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
