/**
 * Число, названное словами. Голосом показание счётчика диктуют, а не набирают:
 * «сто двадцать три запятая четыре» это 123,4. Разбор понимает и просто
 * продиктованные цифры: «один два три» это 123.
 */

/** Слова единиц и десятков, включая женский род: «одна», «две». */
const UNITS: Readonly<Record<string, number>> = {
  ноль: 0,
  нуль: 0,
  один: 1,
  одна: 1,
  одно: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
  шестьдесят: 60,
  семьдесят: 70,
  восемьдесят: 80,
  девяносто: 90,
  сто: 100,
  двести: 200,
  триста: 300,
  четыреста: 400,
  пятьсот: 500,
  шестьсот: 600,
  семьсот: 700,
  восемьсот: 800,
  девятьсот: 900,
};

/** Множители: тысячи и миллионы во всех падежах, какие встречаются в речи. */
const SCALES: Readonly<Record<string, number>> = {
  тысяча: 1000,
  тысячи: 1000,
  тысяч: 1000,
  тысячу: 1000,
  миллион: 1_000_000,
  миллиона: 1_000_000,
  миллионов: 1_000_000,
};

/** Слова, которыми называют запятую. */
const POINT = new Set(['запятая', 'запятую', 'целых', 'целые', 'целая', 'точка', 'точку']);

/**
 * Слова, которые в речи ничего не значат для числа. «Примерно» и «около» сюда
 * не входят: ими человек говорит, что сам не уверен, и показание из такого
 * не делают.
 */
const SKIP = new Set(['и', 'ровно']);

/** Слова долей: «десятых», «сотых». Само число при них уже названо. */
const FRACTIONS = new Set([
  'десятых',
  'десятая',
  'сотых',
  'сотая',
  'тысячных',
  'тысячная',
  'десятитысячных',
]);

/** Сколько разрядов допускает показание: дальше это уже не счётчик. */
const MAX_DIGITS = 7;

/** Показание часто диктуют по цифре: «один два три» это 123, а не шесть. */
const asDigits = (words: readonly string[]): number | undefined => {
  if (words.length < 2) return undefined;
  const digits = words.map((word) => UNITS[word]);

  if (!digits.every((digit) => digit !== undefined && digit < 10)) return undefined;

  return Number(digits.join(''));
};

/** Целая часть из слов: сумма групп с множителями. */
const wholeOf = (words: readonly string[]): number | undefined => {
  let total = 0;
  let group = 0;
  let seen = false;

  for (const word of words) {
    if (SKIP.has(word)) continue;

    const unit = UNITS[word];

    if (unit !== undefined) {
      group += unit;
      seen = true;
      continue;
    }

    const scale = SCALES[word];

    if (scale === undefined) return undefined;

    // «тысяча» без числа перед ней значит одну тысячу.
    total += (group === 0 ? 1 : group) * scale;
    group = 0;
    seen = true;
  }

  return seen ? total + group : undefined;
};

/**
 * Сказанное вообще о числе: есть цифры или числительные. По этому видно, что
 * человек отвечал на вопрос о показании, пусть и неудачно, и переспросить его
 * нужно о том же, а не начинать другой разговор.
 */
export const mentionsNumber = (text: string): boolean => {
  if (/\d/u.test(text)) return true;

  return text
    .toLowerCase()
    .split(/[\s-]+/u)
    .some((word) => UNITS[word] !== undefined || SCALES[word] !== undefined);
};

/**
 * Число из слов. Пусто, если словами названо не число: тогда сказанное разбирают
 * как обычную речь, а не как показание.
 */
export const numberFromWords = (text: string): number | undefined => {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s-]/gu, ' ')
    .split(/[\s-]+/u)
    .filter(Boolean);

  if (words.length === 0) return undefined;

  const at = words.findIndex((word) => POINT.has(word));
  const said = at === -1 ? words : words.slice(0, at);
  const whole = asDigits(said) ?? wholeOf(said);

  if (whole === undefined || String(whole).length > MAX_DIGITS) return undefined;
  if (at === -1) return whole;

  const tail = words.slice(at + 1).filter((word) => !FRACTIONS.has(word));
  const fraction = wholeOf(tail);

  if (fraction === undefined) return undefined;

  // «сто двадцать три запятая ноль пять»: доли читаются так, как сказаны.
  const parts = tail.map((word) => UNITS[word]);
  const digits = parts.every((digit) => digit !== undefined && digit < 10) ? parts.join('') : String(fraction);

  return Number(`${whole}.${digits}`);
};
