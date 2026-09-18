import { arrearsFor, chargesForResident, formatDebtShort, metersFor } from '@domovoy/app';
import { DomainError, formatMoney, METER_RULES, verificationState } from '@domovoy/domain';

import {
  afterError,
  appRow,
  errorText,
  keyboardOf,
  menuButton,
  metersKeyboard,
  oneKeyboard,
  payRows,
  readingKeyboard,
  readingPrompt,
} from '../keyboards.js';
import { expect } from '../max.js';
import type { BotKit, Handler } from '../kit.js';

/**
 * Срок оплаты днём и месяцем. «До 10 числа» человек читает как «какого месяца»,
 * особенно если сегодня уже двадцатое.
 */
const dueDate = (now: Date, day: number): string => {
  const at = new Date(now.getFullYear(), now.getMonth() + (now.getDate() > day ? 1 : 0), day);

  return at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};

/** Счётчики и квитанция: то, из-за чего жилец заходит раз в месяц. */
export const moneyCommands = (kit: BotKit): Record<string, Handler> => {
  const { deps, residentOf } = kit;

  return {
  meters: async (typed) => {
    const resident = await residentOf(typed);

    try {
      const meters = await metersFor(deps, resident);

      if (meters.length === 0) {
        await typed.reply(
          'За вашей квартирой счётчиков не записано. Если они есть, скажите об этом управляющей компании.',
          oneKeyboard('✉️ Написать в компанию', 'menu:support'),
        );
        return;
      }

      const now = deps.now();
      const expired = meters.filter((state) => verificationState(state.meter, now) === 'expired');
      const pending = meters.filter(
        (state) => !state.submittedThisMonth && verificationState(state.meter, now) !== 'expired',
      );

      if (expired.length > 0) {
        await typed.reply(
          `Истёк срок проверки счётчика: ${expired
            .map((state) => `${METER_RULES[state.meter.kind].title} № ${state.meter.serial}`)
            .join(', ')}.\n` +
            'Пока его не проверят, показания принять не могу, и за эту услугу считают по средней норме.\n' +
            'Проверку заказывают в управляющей компании.',
          oneKeyboard('✉️ Написать в компанию', 'menu:support'),
        );
      }

      if (pending.length === 0) {
        if (expired.length < meters.length) {
          await typed.reply('Показания за этот месяц уже поданы. Спасибо.', menuButton(typed));
        }
        return;
      }

      // Приборы идут списком: человек выбирает, с какого начать, и не обязан
      // проходить их подряд, пропуская воду ради электричества.
      if (pending.length > 1) {
        const ready = meters.filter((state) => verificationState(state.meter, now) !== 'expired');

        await typed.reply(
          `Показания за этот месяц: подано ${ready.length - pending.length} из ${ready.length}. Выберите счётчик.`,
          metersKeyboard(ready),
        );
        return;
      }

      typed.session ??= {};
      expect(typed, { kind: 'reading', meterId: pending[0]!.meter.id });

      await typed.reply(readingPrompt(pending[0]!), readingKeyboard(pending[0]!.meter.id, false));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error), afterError(error, typed));
    }
  },

  /** Квитанция: сумма и из чего сложилась. */
  bill: async (typed) => {
    const resident = await residentOf(typed);

    try {
      const charges = await chargesForResident(deps, resident);
      const left = Math.max(0, charges.total - charges.paid);

      if (charges.lines.length === 0) {
        await typed.reply('За этот месяц начислений пока нет.', menuButton(typed));
        return;
      }

      // В переписке остаётся то, ради чего её открыли: сумма, срок и долг.
      // Разбор по строкам, история и оспаривание начисления, работа для экрана.
      const arrears = await arrearsFor(deps, resident);
      const debt = formatDebtShort(arrears);

      await typed.reply(
        [
          left > 0
            ? `Заплатить ${formatMoney(left)} до ${dueDate(deps.now(), charges.dueDay)}`
            : `Начислено ${formatMoney(charges.total)}, за этот месяц всё оплачено`,
          debt,
          'Из чего сложилось и за что, смотрите в приложении.',
        ]
          .filter(Boolean)
          .join('\n'),
        keyboardOf(
          [
            // Кнопка оплаты нужна только там, где платёжный шлюз подключён.
            // Сумма стоит на самой кнопке: «оплатить» и «погасить» в переписке
            // читаются одинаково, а месяц и долг платятся по-разному.
            ...payRows(
              deps.payments && left > 0 ? left : undefined,
              deps.payments && arrears.total + arrears.penalty > 0 ? arrears.total + arrears.penalty : undefined,
            ),
            ...appRow(kit.miniAppUrl, 'Квитанция в приложении', 'meters'),
          ],
          typed,
        ),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error), afterError(error, typed));
    }
    },
  };
};
