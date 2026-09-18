import { DomainError } from '@domovoy/domain';

import type { Reasoner } from './reasoner.js';
import type { AppDeps } from './use-cases.js';

/** Короткие ответы вроде «6» или «-» до модели не доходят: их видно и так. */
const SHORT_ENOUGH = 25;

/**
 * Сказано ли хоть что-то: в ответе есть слово, а не знак, число или пустота.
 * Это первая проверка, она работает и без модели.
 */
export const saysSomething = (text: string): boolean => {
  const trimmed = text.trim();

  if (trimmed.length < 3) return false;

  return (trimmed.match(/\p{L}{2,}/gu) ?? []).length > 0;
};

/**
 * Ответ по делу или отписка. Короткое проверяется моделью: «асдф» и «не знаю»
 * выглядят словами, но заявку с таким описанием никто не выполнит.
 */
const meaningful = async (reasoner: Reasoner | undefined, asked: string, text: string): Promise<boolean> => {
  if (!reasoner?.meaningful || text.trim().length > SHORT_ENOUGH) return true;

  const said = await reasoner.meaningful({ asked, text }).catch(() => undefined);

  return said !== false;
};

export interface SaidCheck {
  /** О чём спрашивали: это уходит модели вместе с ответом. */
  asked: string;
  /** Что ответить человеку, если сказанного мало. */
  hint: string;
  /** Вложения заменяют слова: фотография протечки говорит сама за себя. */
  attachments?: readonly unknown[];
}

/**
 * Проверка сказанного человеком. Пустое и бессмысленное не становится заявкой,
 * записью на приём и вопросом в управляющую организацию: такую запись всё равно
 * никто не выполнит, а человек будет считать, что его услышали.
 *
 * @throws {DomainError}
 */
export const assertSaid = async (deps: AppDeps, text: string, check: SaidCheck): Promise<void> => {
  if (check.attachments?.length) return;

  if (!saysSomething(text) || !(await meaningful(deps.reasoner, check.asked, text))) {
    throw new DomainError('text_empty', check.hint);
  }
};
