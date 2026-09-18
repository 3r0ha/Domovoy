import { DomainError, suggestCategory } from '@domovoy/domain';

import { findCapability } from './assistant.js';
import type { Reasoner } from './reasoner.js';
import type { AppDeps } from './use-cases.js';

/** Короткие ответы вроде «6» или «-» до модели не доходят: их видно и так. */
const SHORT_ENOUGH = 25;

/**
 * Отписки, которые видно без модели. Слова есть, смысла нет: заявку с таким
 * описанием никто не выполнит, а человек будет считать, что его услышали.
 */
const NOTHING_SAID =
  /^(не\s*знаю|незнаю|никак|ничего|нич[её]м|вс[её]|как обычно|сами знаете|хз|пофиг|ага|угу|ок|окей|да|нет|спасибо|здравствуйте|привет|добрый день|доброе утро|добрый вечер)[.!?…]*$/iu;

/**
 * Один знак, нажатый несколько раз: «ыыы», «ааааа», «!!!». Набор вроде «асдф»
 * так не опознать, его по-прежнему разбирает модель.
 */
const GIBBERISH = /^(.)\1{2,}[.!?…]*$/u;

/**
 * Продукт уже понял, о чём речь: слово опознано категорией заявки или названием
 * раздела. Такое до модели не доходит, иначе «капитальный ремонт» и «показания»
 * она считает отпиской и человек получает отказ на осмысленную просьбу.
 */
const known = (text: string, role: string | undefined): boolean => {
  if (suggestCategory(text) !== 'other') return true;

  return role !== undefined && findCapability(text, role as never) !== undefined;
};

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
const meaningful = async (
  reasoner: Reasoner | undefined,
  asked: string,
  text: string,
  role: string | undefined,
): Promise<boolean> => {
  const trimmed = text.trim();

  // Отписка и набор букв видны без модели, а узнанное продуктом слово моделью
  // не проверяется: спорить с ней о «капитальном ремонте» человеку не за что.
  if (NOTHING_SAID.test(trimmed) || GIBBERISH.test(trimmed)) return false;
  if (known(trimmed, role)) return true;

  if (!reasoner?.meaningful || trimmed.length > SHORT_ENOUGH) return true;

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
  /** Чья роль: по ней узнаются названия разделов, которые человек назвал. */
  role?: string;
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

  if (!saysSomething(text) || !(await meaningful(deps.reasoner, check.asked, text, check.role))) {
    throw new DomainError('text_empty', check.hint);
  }
};
