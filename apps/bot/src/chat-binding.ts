import type { Building } from '@domovoy/app';
import type { Bot } from '@maxkit/max-bot-api';

/** Что бот говорит, привязавшись к чату или каналу дома. */
export const boundHere = (building: Building, channel = false): string =>
  `${channel ? 'Канал' : 'Чат'} привязан к дому ${building.address || building.code}.\n` +
  'Сюда буду присылать объявления, аварии и плановые работы. Личное остаётся в переписке.\n' +
  (channel
    ? 'Заявка от жильца: комментарием под постом, с упоминанием «@Домовой».'
    : 'Заявка из чата: «@Домовой» и что случилось.');

/** Просьба дать право закреплять сообщения: им поднимается авария в чате. */
export const pinNote = async (bot: Bot, chatId: number): Promise<string> => {
  try {
    const membership = (await bot.api.getChatMembership(chatId)) as { permissions?: string[] | null };
    const permissions = membership.permissions;

    if (!Array.isArray(permissions) || permissions.includes('pin_message')) return '';
  } catch {
    return '';
  }

  return '\nЧтобы аварии висели наверху чата, дайте мне право закреплять сообщения.';
};
