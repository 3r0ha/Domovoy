import { metersFor, submitReading, visionFailed } from '@domovoy/app';
import {
  DomainError,
  meterUnitKey,
  READING_WINDOW,
  numberFromWords,
  verificationState,
} from '@domovoy/domain';

import { speak } from './i18n.js';
import {
  afterError,
  confirmKeyboard,
  decimal,
  errorText,
  readingKeyboard,
  readingPrompt,
} from './keyboards.js';
import { expect, forget, speaking, strong, type BotContext } from './max.js';
import { thinking } from './thinking.js';
import type { BotKit } from './kit.js';

/** Числа в отказе приходят с точкой, а в переписке они везде с запятой. */
export const commas = (text: string): string => text.replace(/(\d)\.(\d)/g, '$1,$2');

/** Отказы, которые лечатся тем же вводом: человек ошибся в самом числе. */
const RETRY_READING = new Set(['reading_invalid', 'reading_too_large', 'reading_decreased']);

/** Одно число в тексте: цифрами или словами. Два числа это уже не показание. */
const numberIn = (text: string): number | undefined => {
  const found = text.replace(/(\d)\s(?=\d{3}(?!\d))/gu, '$1').match(/\d+(?:[.,]\d+)?/gu) ?? [];

  if (found.length > 1) return undefined;
  if (found.length === 1) return Number(found[0].replace(',', '.'));

  return numberFromWords(text);
};

/**
 * Показание счётчика: за принятым сразу спрашивается следующий прибор.
 * Сказанное голосом не подаётся само, даже если расшифровано цифрами:
 * расшифровка ошибается, а начисление идёт по этому числу, и вернуть его
 * человек уже не сможет. Такое число переспрашивается кнопкой.
 */
export const takeReading = async (
  kit: BotKit,
  typed: BotContext,
  meterId: string,
  text: string,
  byVoice = false,
): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);
  const digits = Number(text.replace(',', '.').replace(/\s/g, ''));

  if (byVoice || !Number.isFinite(digits)) {
    // Голосом показание диктуют и словами, и с названием прибора: «сто двадцать
    // три запятая четыре», «холодная вода 12350».
    const heard = Number.isFinite(digits) ? digits : numberIn(text);

    if (heard === undefined) {
      await typed.reply(t('meters.not_number'), readingKeyboard(meterId, false, t));

      return;
    }

    expect(typed, { kind: 'reading', meterId });

    await typed.reply(
      t('meters.heard', { значение: strong(decimal(heard, t)) }),
      confirmKeyboard(t('button.submit_reading'), `meter-read:${meterId}:${heard}`, t),
    );

    return;
  }

  const value = digits;

  try {
    const result = await submitReading(kit.deps, { resident, meterId, value });

    // Ожидание снимается принятым показанием: на отказ его повторяют тем же вводом.
    forget(typed);

    const meters = await metersFor(kit.deps, resident);
    const meter = meters.find((state) => state.meter.id === meterId);
    const unit = meter ? ` ${t(meterUnitKey(meter.meter.kind))}` : '';

    await typed.reply(
      t('meters.accepted', {
        значение: strong(`${decimal(result.reading.value, t)}${unit}`),
      }) +
        (result.consumption > 0
          ? ` ${t('meters.consumption', { расход: `${decimal(result.consumption, t)}${unit}` })}`
          : '') +
        // Предупреждение о расходе идёт этим же сообщением: отдельным оно
        // приходило раньше чека и читалось как отказ.
        (result.advice ? `\n\n${commas(result.advice)}` : ''),
    );

    const next = meters.find(
      (state) => !state.submittedThisMonth && verificationState(state.meter, kit.deps.now()) !== 'expired',
    );

    if (next) {
      const left = meters.filter(
        (state) => !state.submittedThisMonth && verificationState(state.meter, kit.deps.now()) !== 'expired',
      );

      expect(typed, { kind: 'reading', meterId: next.meter.id });
      await typed.reply(readingPrompt(next, t), readingKeyboard(next.meter.id, left.length > 1, t));
    }
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;

    // Отказ из-за самого числа поправим тем же вводом: ожидание остаётся, и
    // человек присылает показание заново. Остальное повтором не лечится.
    if (RETRY_READING.has(error.code)) {
      expect(typed, { kind: 'reading', meterId });

      await typed.reply(
        `${t('meters.refused', { причина: commas(errorText(error, t)) })}\n${t('meters.retry')}`,
        readingKeyboard(meterId, false, t),
      );

      return;
    }

    // Расчётный период идёт от начала окна подачи, а не от первого числа:
    // без этой строки «уже подано» выглядит ошибкой продукта.
    const next =
      error.code === 'reading_duplicate' ? `\n${t('meters.next_window', { день: READING_WINDOW.fromDay })}` : '';

    await typed.reply(
      `${t('meters.refused', { причина: commas(errorText(error, t)) })}${next}`,
      afterError(error, typed, t),
    );
  }
};

/**
 * Показание с фотографии табло. Число не подаётся само: продукт показывает, что
 * увидел, и ждёт ответа. Ошибиться в цифре на снимке легко, а показание уходит
 * в начисление, и вернуть его человек уже не может.
 */
export const readFromPhoto = async (
  kit: BotKit,
  typed: BotContext,
  meterId: string,
  photoUrl: string | undefined,
): Promise<void> => {
  const t = speaking(typed);

  if (!photoUrl || !kit.vision?.readUrl) {
    await typed.reply(t('meters.no_vision'), readingKeyboard(meterId, false, t));

    return;
  }

  // Разбор снимка идёт секунды: на это время в переписке видно, что он идёт.
  const looking = thinking(kit, typed, t('thinking.photo'));
  let value: number | undefined;

  try {
    value = await kit.vision.readUrl(photoUrl);
  } catch (error) {
    await looking();

    // Снимок не табло или служба молчит: и то и другое лечится числом в ответ.
    const failed = visionFailed(error);

    await typed.reply(
      `${errorText(failed, t)} ` +
        (failed.code === 'meter_not_in_photo' ? t('meters.photo_aim') : t('meters.photo_number')),
      readingKeyboard(meterId, false, t),
    );

    return;
  }

  await looking();

  if (value === undefined) {
    await typed.reply(t('meters.photo_unreadable'), readingKeyboard(meterId, false, t));

    return;
  }

  // Ожидание остаётся: человек может не нажимать кнопку, а прислать своё число.
  expect(typed, { kind: 'reading', meterId });

  await typed.reply(
    t('meters.from_photo', { значение: strong(decimal(value, t)) }),
    confirmKeyboard(t('button.submit_reading'), `meter-read:${meterId}:${value}`, t),
  );
};
