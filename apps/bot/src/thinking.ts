import { RU } from './i18n.js';
import { midOf, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Через сколько молчания человек решает, что ответа не будет. */
const SILENCE_MS = 1200;

/**
 * Отметка «Думаю…» на время долгого ответа. Модель отвечает секунды, и без
 * этой строки переписка выглядит так, будто сообщение не дошло. Строка
 * появляется только если ответ и правда задержался, и убирается вместе с ним.
 * Для разбора записи и снимка слово своё: «Расшифровываю…», «Смотрю на снимок…».
 */
export const thinking = (
  kit: BotKit,
  typed: BotContext,
  note = RU('thinking.default'),
): (() => Promise<void>) => {
  const chatId = typed.chatId;
  let mid: string | undefined;
  let done = false;

  if (chatId !== undefined) void kit.bot.api.sendAction(chatId, 'typing_on').catch(() => undefined);

  const later = setTimeout(() => {
    void (async () => {
      // Пустая клавиатура, а не её отсутствие: иначе к отметке допишется выход,
      // по которому человек успеет нажать до самого ответа.
      const sent = await typed.reply(note, {}).catch(() => undefined);

      if (done) {
        const late = midOf(sent);

        if (late) await kit.bot.api.deleteMessage(late).catch(() => undefined);

        return;
      }

      mid = midOf(sent);
    })();
  }, SILENCE_MS);

  return async () => {
    done = true;
    clearTimeout(later);

    if (mid) await kit.bot.api.deleteMessage(mid).catch(() => undefined);
  };
};
