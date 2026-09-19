import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BOM, csvFrom } from '../dist/index.js';

/** Строки файла без метки порядка байтов и без завершающего перевода. */
const linesOf = (csv: string): string[] => csv.slice(BOM.length).trimEnd().split('\r\n');

describe('выгрузка в таблицу', () => {
  it('разделитель и кавычки ставятся только там, где нужно', () => {
    const [, row] = linesOf(csvFrom({ columns: ['а', 'б'], rows: [['текст', 'с; точкой']] }));

    assert.equal(row, 'текст;"с; точкой"');
  });

  it('описание, начатое со знака формулы, таблица не выполнит', () => {
    const formulas = ['=HYPERLINK("http://злой.сайт";"жми")', '+1+1', '@SUM(A1)', '-2+3+cmd|calc'];

    for (const value of formulas) {
      const [, row] = linesOf(csvFrom({ columns: ['описание'], rows: [[value]] }));

      assert.ok(row?.startsWith("'") || row?.startsWith('"\''), `не обезврежено: ${value}`);
    }
  });

  it('число остаётся числом, и отрицательное тоже', () => {
    const [, row] = linesOf(csvFrom({ columns: ['долг', 'расход'], rows: [[-1200.5, '-3,5']] }));

    assert.equal(row, '-1200.5;-3,5');
  });

  it('обычный текст не портится', () => {
    const [, row] = linesOf(csvFrom({ columns: ['адрес'], rows: [['ул. Ленина, 15']] }));

    assert.equal(row, 'ул. Ленина, 15');
  });
});
