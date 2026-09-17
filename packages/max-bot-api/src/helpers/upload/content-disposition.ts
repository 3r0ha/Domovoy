/**
 * Сборка заголовка `Content-Disposition` для загрузки файла.
 *
 * Значение заголовка передаётся по HTTP как latin-1, поэтому кириллическое имя файла
 * без подготовки доезжает искажённым, а кавычка или перевод строки в имени ломают
 * сам заголовок. По RFC 6266 и RFC 5987 для таких случаев рядом с обычным `filename`
 * передаётся `filename*` с явной кодировкой; получатель, который его не понимает,
 * использует запасное ASCII-имя.
 */

/** Символы, недопустимые внутри значения в кавычках, и всё, что вне ASCII. */
const UNSAFE_ASCII = /[^\x20-\x7E]/g;
const QUOTES_AND_SLASHES = /["\\]/g;

/** Запасное имя из ASCII: непечатаемое и не-ASCII заменяется подчёркиванием. */
export const toAsciiFileName = (fileName: string): string => {
  const ascii = fileName.replace(UNSAFE_ASCII, '_').replace(QUOTES_AND_SLASHES, '_').trim();
  return ascii.length > 0 ? ascii : 'file';
};

/** Процентное кодирование по RFC 5987: обязательно кодируются кавычки, скобки и запятые. */
const encodeExtended = (fileName: string): string => {
  return encodeURIComponent(fileName)
    .replace(/['()!*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
};

export const contentDisposition = (fileName: string): string => {
  const ascii = toAsciiFileName(fileName);
  const header = `attachment; filename="${ascii}"`;

  // Расширенная форма нужна, только если имя не укладывается в ASCII.
  return ascii === fileName ? header : `${header}; filename*=UTF-8''${encodeExtended(fileName)}`;
};
