import { doingFor, type Doing } from '@domovoy/app';
import { describeTarget } from '@domovoy/domain';
import { Keyboard } from '@maxkit/max-bot-api';

import { actionTitle, keyboardOf, menuButton, screenOf } from './keyboards.js';
import { inChat, plain, strong, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Что продукт собирается сделать, словами человека. */
const ABOUT: Record<string, string> = {
  accepted: 'принять заявку в работу',
  in_progress: 'взять наряд в работу',
  needs_info: 'спросить уточнение у жильца',
  done: 'сдать работу',
  confirmed: 'принять работу',
  rejected: 'отклонить заявку',
  withdrawn: 'снять заявку',
};

/** Сколько заявок предлагается кнопками: дальше список не читается. */
const SHOWN = 4;

/** Заявка одной строкой: номер и адрес, чтобы человек узнал, о чём речь. */
const shortly = (request: {
  number: string;
  title: string;
  target: Parameters<typeof describeTarget>[0];
}): string => `${request.number}, ${request.title.slice(0, 40).toLowerCase()}, ${describeTarget(request.target)}`;

/**
 * Дело, названное словами. Продукт показывает, что понял, и ждёт нажатия:
 * закрыть заявку по одной фразе нельзя, а переспрашивать о каждом слове
 * мучительно. Когда подходящих заявок несколько, человек выбирает кнопкой.
 */
export const offerDoing = async (kit: BotKit, typed: BotContext, text: string): Promise<boolean> => {
  // В общем чате дел по заявкам не делают: там читают соседи, а подтверждение
  // и выбор заявки это личный разговор.
  if (inChat(typed)) return false;

  const resident = await kit.residentOf(typed);
  const doing: Doing | undefined = await doingFor(kit.deps, resident, text).catch(() => undefined);

  if (!doing) return false;

  if (doing.kind === 'denied') {
    await typed.reply(doing.reason, menuButton(typed));

    return true;
  }

  const what = ABOUT[doing.to] ?? 'изменить заявку';

  // Слова человека уходят в отчёт вместе с нажатием: переписывать их заново
  // ради подтверждения незачем. Метка привязывает слова к этому предложению:
  // за время раздумий человек мог написать о другом деле.
  const token = `d${Date.now().toString(36)}`;

  typed.session ??= {};
  typed.session.doing = { token, to: doing.to, comment: doing.comment };

  if (!doing.request) {
    await typed.reply(
      `${strong(`Понял: ${what}`)}\nПо какой заявке?`,
      screenOf(
        keyboardOf([
          ...doing.choices
            .slice(0, SHOWN)
            .map((request) => [Keyboard.button.callback(shortly(request), `do:${token}:${request.id}`)]),
          [Keyboard.button.callback('✖️ Ни по какой', 'cancel')],
        ]),
      ),
    );

    return true;
  }

  await typed.reply(
    `${strong(`Понял: ${what}`)}\n${plain(shortly(doing.request))}\n` +
      (doing.requiresComment ? `Записать как «${plain(doing.comment)}»?` : 'Сделать?'),
    screenOf(
      keyboardOf([
        [
          Keyboard.button.callback(
            actionTitle(doing.from, doing.to, doing.requiresComment),
            `do:${token}:${doing.request.id}`,
          ),
        ],
        [Keyboard.button.callback('✖️ Отмена', 'cancel')],
      ]),
    ),
  );

  return true;
};
