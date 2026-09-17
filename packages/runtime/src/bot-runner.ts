import { type Api, Context } from '@maxkit/max-bot-api';
import type { UpdateType } from '@maxkit/max-bot-api/types';

import { UpdateSupervisor, type SupervisorOptions, type UpdateLike } from './supervisor.js';

/** Часть бота, которой достаточно для запуска: транспорт, сведения о боте и цепочка обработчиков. */
export interface RunnableBot {
  api: Api;
  botInfo?: unknown;
  middleware(): (context: never, next: () => Promise<void>) => unknown;
}

export interface BotSupervisorOptions extends Omit<SupervisorOptions, 'fetchUpdates' | 'handleUpdate'> {
  /** Типы апдейтов, которые нужны боту. */
  allowedUpdates?: UpdateType[];
  /** Сколько апдейтов забирать за раз. */
  limit?: number;
  /** Сколько секунд держать открытым запрос long polling. */
  timeoutSeconds?: number;
  /** Свой класс контекста, если бот его переопределяет. */
  contextType?: new (...args: ConstructorParameters<typeof Context>) => Context;
}

/** Собирает супервизор, который вращает уже настроенного бота. */
export const createBotSupervisor = (bot: RunnableBot, options: BotSupervisorOptions = {}): UpdateSupervisor => {
  const { allowedUpdates, limit, timeoutSeconds, contextType, ...supervisorOptions } = options;
  const ContextType = contextType ?? Context;

  return new UpdateSupervisor({
    ...supervisorOptions,

    fetchUpdates: async ({ marker, signal }) => {
      const response = await bot.api.getUpdates(allowedUpdates, {
        ...(marker !== undefined ? { marker } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(timeoutSeconds !== undefined ? { timeout: timeoutSeconds } : {}),
        signal,
      });

      return { updates: response.updates as unknown as UpdateLike[], marker: response.marker };
    },

    handleUpdate: async (update) => {
      const context = new ContextType(update as never, bot.api, bot.botInfo as never);
      await bot.middleware()(context as never, () => Promise.resolve());
    },
  });
};
