/** Метка порядка байтов: без неё Excel читает кириллицу неверно. */
export const BOM = String.fromCodePoint(0xfeff);

/** Разделитель: точка с запятой, как у Excel с русской локалью. */
const SEPARATOR = ';';

/** Кавычки только там, где без них строка разъедется. */
const cell = (value: string | number): string => {
  const text = String(value);

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
