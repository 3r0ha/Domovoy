import { bindHouseChat, buildingByChat, unbindHouseChat } from '@domovoy/app';
import { DomainError } from '@domovoy/domain';

import { boundHere, pinNote } from './chat-binding.js';
import { nameOf, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Бота добавили в чат дома: управляющему чат привязывается сразу. */
const added = async (kit: BotKit, typed: BotContext): Promise<void> => {
  const chatId = typed.chatId;

  if (chatId === undefined) return;

  const { bot, deps } = kit;
  const who = await kit.residentOf(typed);
  const channel = (typed.update as { is_channel?: boolean }).is_channel === true;

  if (who.role === 'manager') {
    try {
      const building = await bindHouseChat(deps, who, chatId);

      await bot.api.sendMessageToChat(
        chatId,
        `${boundHere(building, channel)}${await pinNote(bot, chatId)}`,
        kit.openApp(),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;

      await bot.api.sendMessageToChat(chatId, error.message);
    }

    return;
  }

  const building = await buildingByChat(deps, chatId);

  await bot.api.sendMessageToChat(
    chatId,
    building
      ? `${boundHere(building, channel)}${await pinNote(bot, chatId)}`
      : 'Здравствуйте! Я Домовой: принимаю заявки и объявляю об авариях и работах.\n' +
        'Чтобы привязать этот чат к дому, управляющий даёт здесь команду /here.',
    kit.openApp(),
  );
};

/** Новый сосед в чате: одно сообщение о том, что здесь можно, и приложение. */
const joined = async (kit: BotKit, typed: BotContext): Promise<void> => {
  const chatId = typed.chatId;
  const user = typed.user;

  if (chatId === undefined || user?.user_id === undefined || user.user_id === typed.myId) return;

  const building = await buildingByChat(kit.deps, chatId);

  if (!building) return;

  await kit.bot.api.sendMessageToChat(
    chatId,
    `${nameOf(user)}, здравствуйте! Я Домовой, слежу за домом ${building.address || building.code}.\n` +
      'Что сломалось: напишите здесь «@Домовой» и что случилось, оформлю заявку и назову срок.\n' +
      'Счётчики, квитанция и домофон доступны в личной переписке со мной.',
    kit.openApp(),
  );
};

/** События чата: бота добавили, убрали, в чат вошёл новый сосед. */
export const registerChatEvents = (kit: BotKit): void => {
  kit.bot.on('bot_added', (context) => added(kit, context as never as BotContext));

  kit.bot.on('bot_removed', async (context) => {
    const chatId = (context as never as BotContext).chatId;

    if (chatId !== undefined) await unbindHouseChat(kit.deps, chatId);
  });

  kit.bot.on('user_added', (context) => joined(kit, context as never as BotContext));
};
