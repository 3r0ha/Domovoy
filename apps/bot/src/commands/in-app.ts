import { appRow, keyboardOf } from '../keyboards.js';
import type { BotContext } from '../max.js';
import type { BotKit } from '../kit.js';

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
  title = 'Открыть в приложении',
): Promise<void> => {
  await typed.reply(
    kit.miniAppUrl ? text : `${text}\nОткройте мини-приложение «Домовой» в MAX.`,
    keyboardOf([...appRow(kit.miniAppUrl, title, screen)], typed),
  );
};
