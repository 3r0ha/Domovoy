import { deflateRawSync } from 'node:zlib';

/**
 * Книга Excel без сторонних библиотек: xlsx это zip с несколькими xml.
 * Отчётность принимают книгой, поэтому одного CSV мало.
 */
export type Cell = string | number;

export interface Sheet {
  /** Имя листа: Excel не пускает в него : \ / ? * [ ] и больше 31 знака. */
  name: string;
  rows: Cell[][];
}

/** Управляющие символы книгу ломают: Excel считает такой файл повреждённым. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu;

const escape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(CONTROL, '');

/** A, B … Z, AA: имя столбца по его номеру. */
const columnName = (index: number): string => {
  let name = '';

  for (let rest = index; rest >= 0; rest = Math.floor(rest / 26) - 1) {
    name = String.fromCodePoint(65 + (rest % 26)) + name;
  }

  return name;
};

const cellXml = (value: Cell, column: number, row: number): string => {
  const at = `${columnName(column)}${row}`;

  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${at}"><v>${value}</v></c>`;

  return `<c r="${at}" t="inlineStr"><is><t xml:space="preserve">${escape(String(value))}</t></is></c>`;
};

const sheetXml = (sheet: Sheet): string =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
  sheet.rows
    .map(
      (cells, index) =>
        `<row r="${index + 1}">${cells.map((value, column) => cellXml(value, column, index + 1)).join('')}</row>`,
    )
    .join('') +
  '</sheetData></worksheet>';

const workbookXml = (sheets: Sheet[]): string =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
  sheets
    .map((sheet, index) => `<sheet name="${escape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('') +
  '</sheets></workbook>';

const workbookRels = (sheets: Sheet[]): string =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}"` +
        ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"' +
        ` Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('') +
  '</Relationships>';

const contentTypes = (sheets: Sheet[]): string =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml"' +
  ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml"` +
        ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    )
    .join('') +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1"' +
  ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"' +
  ' Target="xl/workbook.xml"/></Relationships>';

/** Таблица CRC32: её требует формат zip. */
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;

  return value >>> 0;
});

const crc32 = (bytes: Buffer): number => {
  let value = 0xff_ff_ff_ff;

  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);

  return (value ^ 0xff_ff_ff_ff) >>> 0;
};

interface Entry {
  name: string;
  source: Buffer;
  packed: Buffer;
  crc: number;
  offset: number;
}

/** Zip без внешних зависимостей: заголовок записи, данные, каталог в конце. */
const zip = (files: { name: string; content: string }[]): Buffer => {
  const entries: Entry[] = [];
  const parts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const source = Buffer.from(file.content, 'utf8');
    const packed = deflateRawSync(source);
    const name = Buffer.from(file.name, 'utf8');
    const header = Buffer.alloc(30);

    header.writeUInt32LE(0x04_03_4b_50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(0, 10);
    const crc = crc32(source);

    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(source.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);

    entries.push({ name: file.name, source, packed, crc, offset });
    parts.push(header, name, packed);
    offset += header.length + name.length + packed.length;
  }

  const directory: Buffer[] = [];
  let directoryLength = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const record = Buffer.alloc(46);

    record.writeUInt32LE(0x02_01_4b_50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(0, 12);
    record.writeUInt32LE(entry.crc, 16);
    record.writeUInt32LE(entry.packed.length, 20);
    record.writeUInt32LE(entry.source.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(entry.offset, 42);

    directory.push(record, name);
    directoryLength += record.length + name.length;
  }

  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryLength, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, ...directory, end]);
};

/** Тип книги в ответе: по нему клиент открывает файл в таблицах. */
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Книга из готовых строк: первая строка листа считается шапкой таблицы. */
export const buildXlsx = (sheets: Sheet[]): Buffer =>
  zip([
    { name: '[Content_Types].xml', content: contentTypes(sheets) },
    { name: '_rels/.rels', content: ROOT_RELS },
    { name: 'xl/workbook.xml', content: workbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels(sheets) },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: sheetXml(sheet),
    })),
  ]);
