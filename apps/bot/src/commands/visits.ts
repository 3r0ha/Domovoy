import { formatVisit, listVisitsFor, receptionFor, zoneOf, type Resident } from '@domovoy/app';
import { DomainError, isCompanyStaff } from '@domovoy/domain';
import { localeOf } from '@domovoy/i18n';

import { speak } from '../i18n.js';
import { menuButton, visitCancelKeyboard } from '../keyboards.js';
import { inApp } from './in-app.js';
import { inChat, plain, strong } from '../max.js';
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
        .toLocaleString(localeOf(speak(resident)), {
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

/** Приём в управляющей организации: своя запись и её отмена в переписке. */
export const visitCommands = (kit: BotKit): Record<string, Handler> => {
  const { deps, residentOf } = kit;

  return {
    visit: async (typed) => {
      const resident = await residentOf(typed);
      const t = speak(resident);

      if (inChat(typed)) {
        await typed.reply(t('visit.in_chat'));
        return;
      }

      try {
        if (isCompanyStaff(resident.role)) {
          const cards = await listVisitsFor(deps, resident);

          // Сетка часов, перенос и отмена записей это календарь: в переписке
          // остаётся счёт, а ведут приём на экране. Своя запись сотрудника
          // делается там же, где и у жильца: он тоже приходит по своим делам.
          await inApp(
            kit,
            typed,
            cards.length === 0 ? 'Записей жильцов на приём нет.' : `Записано жильцов на приём: ${cards.length}.`,
            'visits',
          );

          return;
        }

        const { reception } = await freeHours(kit, resident);

        // Своя запись остаётся в переписке: её отменяют одной кнопкой, и ради
        // этого приложение открывать незачем.
        if (reception.mine) {
          await typed.reply(
            t('visit.mine', {
              когда: strong(formatVisit(reception.mine, await zoneOf(deps, reception.buildingId))),
            }),
            visitCancelKeyboard(reception.mine.id, t),
          );
          return;
        }

        if (reception.slots.length === 0) {
          await typed.reply(
            reception.windows.length === 0 ? t('visit.no_reception') : t('visit.no_slots'),
            menuButton(typed, t),
          );
          return;
        }

        // Выбор времени это календарь на две недели: кнопками он не читается,
        // а на экране видно и дни, и свободные часы разом.
        await inApp(
          kit,
          typed,
          `${strong(
            reception.office ? t('visit.title_office', { офис: plain(reception.office) }) : t('visit.title'),
          )}\n${t('visit.free', { сколько: reception.slots.length })}`,
          'visits',
          t,
        );
      } catch (error) {
        await typed.reply(
          error instanceof DomainError ? error.message : t('visit.not_opened'),
          menuButton(typed, t),
        );
      }
    },
  };
};
