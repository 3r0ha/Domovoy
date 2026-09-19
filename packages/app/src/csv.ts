/** Метка порядка байтов: без неё Excel читает кириллицу неверно. */
export const BOM = String.fromCodePoint(0xfeff);

/** Разделитель: точка с запятой, как у Excel с русской локалью. */
const SEPARATOR = ';';

/** С чего начинается значение, которое таблица посчитает формулой. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Обычное число: минус перед ним формулы не делает. */
const NUMERIC = /^-?\d+(?:[.,]\d+)?$/;

/**
 * Значение из текста жильца попадает в выгрузку как есть, а таблица выполняет
 * то, что начинается со знака формулы. Апостроф перед ним оставляет текст текстом.
 */
const guard = (text: string): string =>
  FORMULA_START.test(text) && !NUMERIC.test(text) ? `'${text}` : text;

/** Кавычки только там, где без них строка разъедется. */
const cell = (value: string | number): string => {
  const text = typeof value === 'number' ? String(value) : guard(value);

  return /["\r\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export interface Table {
  /** Имя файла без расширения, оно же имя листа книги. */
  name: string;
  columns: string[];
  rows: (string | number)[][];
}

/** Готовый файл: заголовок, строки и перевод строки в конце. */
export const csvFrom = (table: Pick<Table, 'columns' | 'rows'>): string => {
  const lines = [table.columns, ...table.rows].map((values) => values.map(cell).join(SEPARATOR));

  return `${BOM}${lines.join('\r\n')}\r\n`;
};
