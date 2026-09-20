import { arrearsFor, chargesForResident, formatDebtShort, metersFor } from '@domovoy/app';
import { DomainError, formatDay, formatMoney, meterKindKey, verificationState } from '@domovoy/domain';
import type { Translate } from '@domovoy/i18n';

import { speak } from '../i18n.js';
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
import { expect, strong } from '../max.js';
import type { BotKit, Handler } from '../kit.js';

/**
 * Срок оплаты днём и месяцем. «До 10 числа» человек читает как «какого месяца»,
 * особенно если сегодня уже двадцатое.
 */
const dueDate = (now: Date, day: number, t: Translate): string => {
  const at = new Date(now.getFullYear(), now.getMonth() + (now.getDate() > day ? 1 : 0), day, 12);

  return formatDay(at, undefined, t);
};

/** Счётчики и квитанция: то, из-за чего жилец заходит раз в месяц. */
export const moneyCommands = (kit: BotKit): Record<string, Handler> => {
  const { deps, residentOf } = kit;

  return {
  meters: async (typed) => {
    const resident = await residentOf(typed);
    const t = speak(resident);

    try {
      const meters = await metersFor(deps, resident);

      if (meters.length === 0) {
        await typed.reply(t('meters.none'), oneKeyboard(t('button.write_company'), 'menu:support'));
        return;
      }

      const now = deps.now();
      const expired = meters.filter((state) => verificationState(state.meter, now) === 'expired');
      const pending = meters.filter(
        (state) => !state.submittedThisMonth && verificationState(state.meter, now) !== 'expired',
      );

      if (expired.length > 0) {
        await typed.reply(
          t('meters.expired', {
            приборы: expired
              .map((state) => `${t(meterKindKey(state.meter.kind))} № ${state.meter.serial}`)
              .join(', '),
          }),
          oneKeyboard(t('button.write_company'), 'menu:support'),
        );
      }

      if (pending.length === 0) {
        if (expired.length < meters.length) {
          await typed.reply(t('meters.done'), menuButton(typed, t));
        }
        return;
      }

      // Приборы идут списком: человек выбирает, с какого начать, и не обязан
      // проходить их подряд, пропуская воду ради электричества.
      if (pending.length > 1) {
        const ready = meters.filter((state) => verificationState(state.meter, now) !== 'expired');

        await typed.reply(
          t('meters.progress', { подано: ready.length - pending.length, всего: ready.length }),
          metersKeyboard(ready, t),
        );
        return;
      }

      typed.session ??= {};
      expect(typed, { kind: 'reading', meterId: pending[0]!.meter.id });

      await typed.reply(readingPrompt(pending[0]!, t), readingKeyboard(pending[0]!.meter.id, false, t));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error, t), afterError(error, typed, t));
    }
  },

  /** Квитанция: сумма и из чего сложилась. */
  bill: async (typed) => {
    const resident = await residentOf(typed);
    const t = speak(resident);

    try {
      const charges = await chargesForResident(deps, resident);
      const left = Math.max(0, charges.total - charges.paid);

      if (charges.lines.length === 0) {
        await typed.reply(t('bill.empty'), menuButton(typed, t));
        return;
      }

      // В переписке остаётся то, ради чего её открыли: сумма, срок и долг.
      // Разбор по строкам, история и оспаривание начисления, работа для экрана.
      const arrears = await arrearsFor(deps, resident);
      const debt = formatDebtShort(arrears, t);

      await typed.reply(
        [
          left > 0
            ? t('bill.total', {
                сумма: strong(formatMoney(left, t)),
                срок: strong(dueDate(deps.now(), charges.dueDay, t)),
              })
            : t('bill.paid', { сумма: formatMoney(charges.total, t) }),
          debt,
          t('bill.where'),
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
              t,
            ),
            ...appRow(kit.miniAppUrl, t('button.bill_in_app'), 'meters', t),
          ],
          typed,
          t,
        ),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await typed.reply(errorText(error, t), afterError(error, typed, t));
    }
    },
  };
};
