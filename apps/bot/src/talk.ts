import { askAssistant, startersFor } from '@domovoy/app';

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

  await typed.reply(
    'Спросите словами, что нужно сделать. Я отвечу и открою нужный раздел.\n' +
      'Спрашивать можно подряд, разговор закончится по кнопке.',
    startersKeyboard(startersFor(resident.role)),
  );
};

/**
 * Ответ помощника: короткий текст, кнопка в названный раздел и выход из
 * разговора. Ожидание остаётся, поэтому следующее сообщение это следующий
 * вопрос, и снова искать кнопку «Спросить» не нужно.
 */
export const answerFromAssistant = async (kit: BotKit, typed: BotContext, question: string): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const waiting = thinking(kit, typed);
  const help = await askAssistant(kit.deps, resident, question, typed.session?.talk ?? []).finally(waiting);

  remember(typed, question, help.answer);
  expect(typed, { kind: 'assistant' });

  // Раздел называется словами меню этой роли: в ответе и на кнопке одно и то же.
  const command = help.command?.replace(/^\//, '');
  const item = command ? itemFor(resident, command) : undefined;

  await typed.reply(
    `${help.answer}\n\nСпросите ещё, я отвечу. Или закончите разговор.`,
    talkKeyboard(item && command ? { title: item.title, command } : undefined),
  );
};

/** Готовый вопрос по номеру: им начинают разговор те, кто не знает, что спросить. */
export const askStarter = async (kit: BotKit, typed: BotContext, at: number): Promise<string | undefined> => {
  const resident = await kit.residentOf(typed);
  const question = startersFor(resident.role)[at];

  if (question === undefined) return undefined;

  await answerFromAssistant(kit, typed, question);

  return question;
};
