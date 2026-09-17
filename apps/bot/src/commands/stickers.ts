import { stickersFor } from '@domovoy/app';
import { DomainError, plural } from '@domovoy/domain';

import { afterError } from '../keyboards.js';
import type { BotKit, Handler } from '../kit.js';
import { inApp } from './in-app.js';

/**
 * Наклейки с кодами объектов делаются в приложении: там виден список объектов
 * дома, стиль и своя надпись, а готовая наклейка приходит файлом в переписку.
 * Перебирать сотню квартир кнопками в чате нечем.
 */
export const stickerCommands = (kit: BotKit): Record<string, Handler> => ({
  stickers: async (typed) => {
    const resident = await kit.residentOf(typed);

    try {
      const objects = await stickersFor(kit.deps, resident);

      if (objects.length === 0) {
        await typed.reply('Объектов с кодами в доме пока нет.', kit.openApp(undefined, typed));
        return;
      }

      await inApp(
        kit,
        typed,
        `Объектов с кодами: ${objects.length}. Наклейка выбирается в приложении, а готовая придёт сюда файлом.`,
        'stickers',
        'Наклейки в приложении',
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(error.message, afterError(error, typed));
    }
  },
});

/** Слово с числом объектов: остаётся для сообщений о наклейках. */
export const objectsWord = (count: number): string => plural(count, 'объект', 'объекта', 'объектов');
