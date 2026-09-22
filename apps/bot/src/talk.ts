import { askAssistant, startersFor } from '@domovoy/app';

import { speak } from './i18n.js';
import { startersKeyboard, talkKeyboard } from './keyboards.js';
import { itemFor } from './menu.js';
import { thinking } from './thinking.js';
import { endTalk, expect, remember, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/**
 * Начало разговора с помощником. Прошлые реплики забываются: новый разговор
 * не должен читаться как продолжение вчерашнего.
 */
export const startTalk = async (kit: BotKit, typed: BotContext): Promise<void> => {
  endTalk(typed);
  expect(typed, { kind: 'assistant' });

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  await typed.reply(t('talk.start'), startersKeyboard(startersFor(resident.role, t), t));
};

/**
 * Ответ помощника: короткий текст, кнопка в названный раздел и выход из
 * разговора. Ожидание остаётся, поэтому следующее сообщение это следующий
 * вопрос, и снова искать кнопку «Спросить» не нужно.
 */
export const answerFromAssistant = async (kit: BotKit, typed: BotContext, question: string): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);
  const waiting = thinking(kit, typed, t('thinking.default'));
  const help = await askAssistant(kit.deps, resident, question, typed.session?.talk ?? []).finally(waiting);

  remember(typed, question, help.answer);
  expect(typed, { kind: 'assistant' });

  // Раздел называется словами меню этой роли: в ответе и на кнопке одно и то же.
  const command = help.command?.replace(/^\//, '');
  const item = command ? itemFor(resident, command) : undefined;

  // Вопрос на другом языке: под ответом стоит и переход в раздел, и переход
  // на этот язык. Ответ человеку нужен сразу, а язык он выберет заодно.
  const language =
    help.offerLanguage && help.offerTitle
      ? { title: help.offerTitle, code: help.offerLanguage }
      : undefined;

  // Откуда ответ: собранное моделью это пересказ, а не выписка из правил дома.
  const by = help.by === 'model' ? `${t('talk.byModel')}\n\n` : '';

  await typed.reply(
    `${help.answer}\n\n${by}${t('talk.more')}`,
    talkKeyboard(item && command ? { title: t(item.title), command } : undefined, t, language),
  );
};

/** Готовый вопрос по номеру: им начинают разговор те, кто не знает, что спросить. */
export const askStarter = async (kit: BotKit, typed: BotContext, at: number): Promise<string | undefined> => {
  const resident = await kit.residentOf(typed);
  const question = startersFor(resident.role, speak(resident))[at];

  if (question === undefined) return undefined;

  await answerFromAssistant(kit, typed, question);

  return question;
};
