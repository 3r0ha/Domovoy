import { DomainError, type ErrorCode } from '@domovoy/domain';
import type { Translate } from '@domovoy/i18n';

/** Ключ отказа в словаре: по коду, а не по тексту. */
export const errorKey = (code: ErrorCode): string => `app.error.${code}`;

/**
 * Отказ словами человека. Перевода по коду нет, остаётся текст самой ошибки:
 * причина по-русски лучше, чем её отсутствие.
 */
export const errorTextFor = (t: Translate, error: unknown): string => {
  if (!(error instanceof DomainError)) return error instanceof Error ? error.message : String(error);

  const key = errorKey(error.code);
  const text = t(key);

  return text === key ? error.message : text;
};
