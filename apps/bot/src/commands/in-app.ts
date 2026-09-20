import type { Translate } from '@domovoy/i18n';

import { RU } from '../i18n.js';
import { appRow, keyboardOf } from '../keyboards.js';
import type { BotContext } from '../max.js';
import type { BotKit } from '../kit.js';

/** Сколько строк ответа читаются в переписке: человеку нужен срок и следующее действие. */
export const CHAT_LINES = 5;

/** Длинный ответ в переписке обрезается: целиком он лежит в приложении. */
export const shorten = (text: string, note: string): string => {
  const lines = text.split('\n');

  return lines.length <= CHAT_LINES ? text : [...lines.slice(0, CHAT_LINES - 1), note].join('\n');
};

/**
 * Дело, которое в переписке делать неудобно. В чате остаётся одна строка сути,
 * а работа идёт в приложении: списком, формой и сравнением там, где для этого
 * есть экран. Кнопка открывает сразу нужный раздел.
 */
export const inApp = async (
  kit: BotKit,
  typed: BotContext,
  text: string,
  screen: string,
  title?: string,
  t: Translate = RU,
): Promise<void> => {
  await typed.reply(
    kit.miniAppUrl ? text : `${text}\n${t('app.install')}`,
    keyboardOf([...appRow(kit.miniAppUrl, title ?? t('button.in_app'), screen)], typed, t),
  );
};
