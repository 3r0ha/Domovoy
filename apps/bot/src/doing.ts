import { doingFor, type Doing } from '@domovoy/app';
import { describeTarget } from '@domovoy/domain';
import type { Translate } from '@domovoy/i18n';
import { Keyboard } from '@maxkit/max-bot-api';

import { speak } from './i18n.js';
import { actionTitle, assignKeyboard, keyboardOf, menuButton, screenOf } from './keyboards.js';
import { inChat, plain, strong, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/** Что продукт собирается сделать, словами человека. */
const ABOUT: Record<string, string> = {
  accepted: 'doing.accepted',
  in_progress: 'doing.in_progress',
  // Жилец не берёт наряд: он возвращает сданную работу мастеру.
  'in_progress:resident': 'doing.return',
  needs_info: 'doing.needs_info',
  done: 'doing.done',
  confirmed: 'doing.confirmed',
  rejected: 'doing.rejected',
  withdrawn: 'doing.withdrawn',
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
 * Поручение наряда словами. Заявка и человек, названные в словах, уже выбраны:
 * остаётся нажать. Не названное спрашивается кнопками, и это тот же выбор,
 * что и на карточке заявки.
 */
const offerAssign = async (
  kit: BotKit,
  typed: BotContext,
  doing: Doing & { kind: 'assign' },
  t: Translate,
): Promise<boolean> => {
  if (!doing.request) {
    await typed.reply(
      `${strong(t('doing.understood', { что: t('doing.assign') }))}\n${t('doing.which')}`,
      screenOf(
        keyboardOf([
          ...doing.choices
            .slice(0, SHOWN)
            .map((request) => [Keyboard.button.callback(shortly(request), `assign:${request.id}`)]),
          [Keyboard.button.callback(t('button.none_of'), 'cancel')],
        ]),
      ),
    );

    return true;
  }

  const people = doing.staff ? [doing.staff] : doing.candidates;

  await typed.reply(
    `${strong(t('doing.understood', { что: t('doing.assign') }))}\n${plain(shortly(doing.request))}\n` +
      (doing.staff ? `Мастер: ${plain(doing.staff.displayName)}. Поручить?` : 'Кому поручить?'),
    screenOf(assignKeyboard(doing.request.id, people, kit.miniAppUrl)),
  );

  return true;
};

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
  const t = speak(resident);
  const doing: Doing | undefined = await doingFor(kit.deps, resident, text).catch(() => undefined);

  if (!doing) return false;

  if (doing.kind === 'denied') {
    await typed.reply(doing.reason, menuButton(typed, t));

    return true;
  }

  if (doing.kind === 'assign') return await offerAssign(kit, typed, doing, t);

  const what = t(ABOUT[`${doing.to}:${resident.role}`] ?? ABOUT[doing.to] ?? 'doing.change');

  // Слова человека уходят в отчёт вместе с нажатием: переписывать их заново
  // ради подтверждения незачем. Метка привязывает слова к этому предложению:
  // за время раздумий человек мог написать о другом деле.
  const token = `d${Date.now().toString(36)}`;

  typed.session ??= {};
  typed.session.doing = { token, to: doing.to, comment: doing.comment };

  if (!doing.request) {
    await typed.reply(
      `${strong(t('doing.understood', { что: what }))}\n${t('doing.which')}`,
      screenOf(
        keyboardOf([
          ...doing.choices
            .slice(0, SHOWN)
            .map((request) => [Keyboard.button.callback(shortly(request), `do:${token}:${request.id}`)]),
          [Keyboard.button.callback(t('button.none_of'), 'cancel')],
        ]),
      ),
    );

    return true;
  }

  await typed.reply(
    `${strong(t('doing.understood', { что: what }))}\n${plain(shortly(doing.request))}\n` +
      (doing.requiresComment ? t('doing.write_as', { что: plain(doing.comment) }) : t('doing.confirm')),
    screenOf(
      keyboardOf([
        [
          Keyboard.button.callback(
            actionTitle(doing.from, doing.to, doing.requiresComment, t),
            `do:${token}:${doing.request.id}`,
          ),
        ],
        [Keyboard.button.callback(t('button.cancel'), 'cancel')],
      ]),
    ),
  );

  return true;
};
