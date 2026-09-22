/**
 * Чтение полей из ответа модели. За границей продукта ответ приходит любым:
 * с кавычками, звёздочками разметки, именем поля перед значением, чужим
 * регистром и переведёнными на язык человека значениями. Ни одно такое поле
 * не должно ронять сценарий: непонятное читается как «модель промолчала».
 */

/** Разметка и кавычки, за которыми прячется само значение. */
const MARKUP = /[`*_"'«»]/gu;

const LATIN_WORD = /[a-z][a-z_]*/u;

/**
 * Служебное значение поля: имя раздела, категория, код дела. Такие значения
 * записаны латиницей и переводу не подлежат, поэтому берётся первое латинское
 * слово: «**meters**», «screen: meters» и «Meters (Показания)» это одно и то же.
 */
export const fieldCode = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const cleaned = value.toLowerCase().replace(MARKUP, ' ');
  const after = cleaned.includes(':') ? cleaned.slice(cleaned.lastIndexOf(':') + 1) : cleaned;

  return LATIN_WORD.exec(after)?.[0];
};

const YES: readonly string[] = ['true', 'yes', 'да', 'ha', 'bəli', 'ооба', 'әйе', 'иә'];
const NO: readonly string[] = ['false', 'no', 'нет', 'yoq', 'xeyr', 'жок', 'жоқ', 'юк'];

/** Первое слово строки без знаков: по нему читается «да» или «нет». */
const firstWord = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .trim()
    .split(/\s+/u)[0] ?? '';

/**
 * «Да или нет» из ответа модели. Она отвечает то булевым значением, то словом,
 * то числом, то строкой «false», и на своём языке тоже. Непонятное это пусто:
 * проверять нечем, а не «нет».
 */
export const fieldFlag = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== 'string') return undefined;

  const word = firstWord(value);

  if (YES.includes(word)) return true;
  if (NO.includes(word)) return false;

  return undefined;
};

const FENCE = /```[a-z]*\n?|```/gu;
const BOLD = /\*{1,3}([^*\n]+)\*{1,3}/gu;
const HEADING = /^#{1,6}\s*/gmu;
const BULLET = /^[ \t]*[-*•]\s+/gmu;

const PAIRS: readonly [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ['«', '»'],
  ['`', '`'],
];

/** Текст целиком в кавычках: модель берёт в них и ответ, и заголовок. */
const unwrapped = (text: string): string => {
  for (const [open, close] of PAIRS) {
    if (!text.startsWith(open) || !text.endsWith(close) || text.length <= 2) continue;

    const inner = text.slice(open.length, -close.length);

    // Кавычки внутри означают, что внешние это часть текста, а не рамка.
    if (!inner.includes(open) && !inner.includes(close)) return inner.trim();
  }

  return text;
};

/**
 * Текст от модели человеку: рамки кода, звёздочки, заголовки, маркеры списка
 * и внешние кавычки снимаются. Пусто означает, что текста не пришло.
 */
export const fieldText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const text = value.replace(FENCE, ' ').replace(BOLD, '$1').replace(HEADING, '').replace(BULLET, '').trim();

  return unwrapped(text).trim() || undefined;
};

/** Значение поля по словарю слов: модель отвечает и ключом, и переводом ключа. */
export const fieldBy = <T>(value: unknown, rules: readonly { value: T; words: RegExp }[]): T | undefined => {
  if (typeof value !== 'string') return undefined;

  const said = value.toLowerCase().replace(MARKUP, ' ');

  return rules.find((rule) => rule.words.test(said))?.value;
};

/** Строка для сверки со справочником продукта: без разметки, кавычек и регистра. */
export const sameAs = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const text = value.replace(MARKUP, ' ').replace(/\s+/gu, ' ').trim().toLowerCase();

  return text.length > 0 ? text : undefined;
};
