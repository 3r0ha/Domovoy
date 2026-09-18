import { timingSafeEqual } from 'node:crypto';

/**
 * Проверка общего секрета в заголовке. Сравнение идёт за постоянное время:
 * по длительности ответа секрет не подбирается.
 */
export const secretGuard = (secret: string): ((header: string | string[] | undefined) => boolean) => {
  const expected = Buffer.from(secret);

  return (header) => {
    const value = Array.isArray(header) ? header[0] : header;

    if (typeof value !== 'string') return false;

    const received = Buffer.from(value);

    return received.length === expected.length && timingSafeEqual(received, expected);
  };
};
