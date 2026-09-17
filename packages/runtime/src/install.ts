import { createResilientClient, type ResilientClient, type ResilientClientOptions } from './client.js';

/** Конструктор `Api` из любой копии SDK. */
export interface ApiConstructor<TApi> {
  new (client: ResilientClient): TApi;
}

/** Часть бота, которая нужна для подмены транспорта. */
export interface BotLike {
  api: object;
}

/** Собирает `Api` поверх устойчивого транспорта. */
export const createResilientApi = <TApi>(
  ApiClass: ApiConstructor<TApi>,
  token: string,
  options: ResilientClientOptions = {},
): TApi => new ApiClass(createResilientClient(token, options));

/** Заменяет транспорт у уже созданного бота. */
export const installResilientApi = <TBot extends BotLike>(
  bot: TBot,
  token: string,
  options: ResilientClientOptions = {},
): TBot => {
  const ApiClass = bot.api.constructor as ApiConstructor<TBot['api']>;
  bot.api = createResilientApi(ApiClass, token, options);
  return bot;
};
