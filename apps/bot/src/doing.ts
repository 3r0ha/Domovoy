import { doingFor, type Doing } from '@domovoy/app';
import { describeTarget } from '@domovoy/domain';
import { Keyboard } from '@maxkit/max-bot-api';

import { keyboardOf } from './keyboards.js';
import { strong, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Что продукт собирается сделать, словами человека. */
const ABOUT: Record<string, string> = {
  accepted: 'принять заявку в работу',
  in_progress: 'вернуть заявку в работу',
  needs_info: 'спросить уточнение у жильца',
  done: 'сдать работу',
  confirmed: 'принять работу',
  rejected: 'отклонить заявку',
  withdrawn: 'снять заявку',
};

/** Подпись согласия: словами о самом деле, а не «Да». */
const AGREE: Record<string, string> = {
  accepted: '✅ Принять в работу',
  in_progress: '↩️ Вернуть в работу',
  needs_info: '❓ Спросить жильца',
  done: '🏁 Сдать работу',
  confirmed: '✅ Принять работу',
  rejected: '⛔ Отклонить',
  withdrawn: '✖️ Снять заявку',
};

/** Заявка одной строкой: номер и адрес, чтобы человек узнал, о чём речь. */
const shortly = (request: { number: string; title: string; target: Parameters<typeof describeTarget>[0] }): string =>
  `${request.number}, ${request.title.toLowerCase()}, ${describeTarget(request.target)}`;

/**
 * Дело, названное словами. Продукт показывает, что понял, и ждёт нажатия:
 * закрыть чужую заявку по одной фразе нельзя, а переспрашивать о каждом слове
 * мучительно. Когда подходящих заявок несколько, человек выбирает кнопкой.
 */
export const offerDoing = async (kit: BotKit, typed: BotContext, text: string): Promise<boolean> => {
  const resident = await kit.residentOf(typed);
  const doing: Doing | undefined = await doingFor(kit.deps, resident, text).catch(() => undefined);

  if (!doing) return false;

  const what = ABOUT[doing.to] ?? 'изменить заявку';

  // Слова человека уходят в отчёт вместе с нажатием: переписывать их заново
  // ради подтверждения незачем.
  typed.session ??= {};
  typed.session.doing = { to: doing.to, comment: doing.comment };

  if (!doing.request) {
    await typed.reply(
      `${strong(`Понял: ${what}`)}\nПо какой заявке?`,
      keyboardOf([
        ...doing.choices
          .slice(0, 5)
          .map((request) => [Keyboard.button.callback(shortly(request), `do:${doing.to}:${request.id}`)]),
        [Keyboard.button.callback('✖️ Отмена', 'cancel')],
      ]),
    );

    return true;
  }

  await typed.reply(
    `${strong(`Понял: ${what}`)}\n${shortly(doing.request)}\n` +
      (doing.requiresComment ? `Записать как «${doing.comment}»?` : 'Сделать?'),
    keyboardOf([
      [Keyboard.button.callback(AGREE[doing.to] ?? '✅ Сделать', `do:${doing.to}:${doing.request.id}`)],
      [Keyboard.button.callback('✖️ Отмена', 'cancel')],
    ]),
  );

  return true;
};
