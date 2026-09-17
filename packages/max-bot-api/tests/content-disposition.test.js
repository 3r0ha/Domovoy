const assert = require('node:assert/strict');
const { test } = require('node:test');

const { contentDisposition, toAsciiFileName } = require('../dist/helpers/upload/content-disposition');

test('an ascii name goes as is', () => {
  assert.equal(contentDisposition('report.pdf'), 'attachment; filename="report.pdf"');
});

test('a cyrillic name gets the extended form', () => {
  const header = contentDisposition('акт-приёмки.pdf');

  assert.match(header, /^attachment; filename="[^"]*"; filename\*=UTF-8''/);
  assert.match(header, /filename\*=UTF-8''%D0%B0%D0%BA%D1%82/);
});

test('a quote in the name cannot break the header', () => {
  const header = contentDisposition('счёт "за январь".pdf');

  assert.equal(header.match(/"/g).length, 2, 'the quoted value stays a single value');
});

test('control characters are dropped', () => {
  const header = contentDisposition('плохое\r\nX-Injected: 1.pdf');

  assert.equal(header.includes('\r'), false);
  assert.equal(header.includes('\n'), false);
});

test('an empty ascii fallback never appears', () => {
  assert.equal(toAsciiFileName('акт.pdf'), '___.pdf');
  assert.equal(toAsciiFileName('акт'), '___');
  assert.equal(toAsciiFileName('   '), 'file');
});
