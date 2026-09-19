import { describeFromAttachments, submitProblem, unheardVoice, type Building, type Resident } from '@domovoy/app';
import { DomainError, encodeTarget, type Attachment } from '@domovoy/domain';

import { addressed, isChatter, mentionsOf, shown, toAttachments, withoutMention, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Обращение из чата заводится по дому, если жилец ещё не привязан к квартире. */
const whereFrom = (resident: Resident, building?: Building): string | undefined =>
  !resident.apartmentId && building ? encodeTarget({ kind: 'building', buildingId: building.id }) : undefined;

/** Заявка по сказанному в чате. */
const report = async (
  kit: BotKit,
  typed: BotContext,
  building: Building | undefined,
  description: string,
  attached: Attachment[],
): Promise<void> => {
  const resident = await kit.residentOf(typed, building?.id);
  const startParam = whereFrom(resident, building);

  try {
    const { description: sense, attachments } = await describeFromAttachments(description, attached, kit.transcriber);

    if (attachments.length === 0 && (await kit.answered(typed, resident, sense, startParam))) return;

    const result = await submitProblem(kit.deps, {
      resident,
      description: sense,
      ...(attachments.length ? { attachments } : {}),
      ...(startParam ? { startParam } : {}),
    });

    await kit.announce(typed, result, sense, startParam, !description.trim() && unheardVoice(attachments));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;

    await typed.reply(`${error.message}. Привязать чат к дому может управляющий командой /here.`, kit.openApp(undefined, typed));
  }
};

/** Обращение из общего чата: бот отвечает, только когда его позвали. */
export const speakInChat = async (kit: BotKit, typed: BotContext): Promise<void> => {
  if (!addressed(typed)) return;

  const said = withoutMention(typed);

  if (said.startsWith('/')) return;

  const building = await kit.houseOf(typed);
  const quoted = typed.message?.link?.message?.text?.trim() ?? '';
  const attached = toAttachments(typed.message?.body?.attachments);
  const description = isChatter(said) && quoted ? quoted : said;

  if (isChatter(description) && attached.length === 0) {
    if (mentionsOf(typed).length > 0) await typed.reply(kit.chatHelp(building), kit.openApp(undefined, typed));

    return;
  }

  await report(kit, typed, building, description, attached);
};

/**
 * Комментарий под постом канала: у дома с каналом вместо чата заявка заводится
 * в комментариях, и ответ уходит в ту же ветку.
 */
export const registerComments = (kit: BotKit, onError?: (error: unknown) => void): void => {
  const sayInThread = async (
    typed: BotContext,
    text: string,
    extra?: Record<string, unknown>,
  ): Promise<unknown> => {
    const post = typed.message?.recipient?.post_id;
    const ready = shown(text, extra);

    if (post !== undefined && post !== null) {
      try {
        return await kit.bot.api.sendComment(String(post), ready.text, ready.extra ?? {});
      } catch (error) {
        onError?.(error);
      }
    }

    return typed.chatId === undefined
      ? undefined
      : kit.bot.api.sendMessageToChat(typed.chatId, ready.text, ready.extra);
  };

  kit.bot.on('comment_created', async (context) => {
    const typed = context as never as BotContext;
    const said = typed.message?.body?.text?.trim();

    if (said?.startsWith('/')) return;

    // Состояние диалога лежит на исходном контексте: производный до хранилища не доедет.
    typed.session ??= {};

    const inThread = Object.create(typed) as BotContext;

    inThread.reply = (text, extra) => sayInThread(typed, text, extra);

    await speakInChat(kit, inThread);
  });
};
