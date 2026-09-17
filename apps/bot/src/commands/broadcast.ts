import { broadcastTargets } from '@domovoy/app';
import { DomainError, plural } from '@domovoy/domain';

import { afterError } from '../keyboards.js';
import type { BotKit, Handler } from '../kit.js';
import { inApp } from './in-app.js';

/** «12 человек», «21 человек». */
export const people = (count: number): string => plural(count, 'человек', 'человека', 'человек');

/**
 * Рассылка собирается в приложении: адресат выбирается из подъездов, стояков,
 * квартир и собраний, а охват виден до отправки. В переписке такой выбор
 * превращается в десяток сообщений, поэтому бот только открывает раздел.
 */
export const broadcastCommands = (kit: BotKit): Record<string, Handler> => ({
  broadcast: async (typed) => {
    const resident = await kit.residentOf(typed);

    try {
      const targets = await broadcastTargets(kit.deps, resident);

      if (targets.flats === 0) {
        await typed.reply('В доме ещё нет квартир, рассылать некому.');
        return;
      }

      await inApp(
        kit,
        typed,
        'Рассылка собирается в приложении: там выбирается адресат и виден охват до отправки.',
        'broadcast',
        'Рассылка в приложении',
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(error.message, afterError(error, typed));
    }
  },
});
