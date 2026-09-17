const assert = require('node:assert/strict');
const { test } = require('node:test');

const { fmt } = require('../dist');

test('underline uses the MAX syntax', () => {
  assert.equal(fmt.underline('важно'), '++важно++');
});

test('markdown link survives parentheses in the url', () => {
  const url = 'https://example.test/docs_(v2)/page';

  assert.equal(fmt.link('инструкция', url), '[инструкция](https://example.test/docs_%28v2%29/page)');
});

test('markdown link survives spaces in the url', () => {
  assert.equal(fmt.link('файл', 'https://example.test/акт приёмки.pdf'), '[файл](https://example.test/акт%20приёмки.pdf)');
});

test('escapeUrl leaves an ordinary url untouched', () => {
  const url = 'https://example.test/requests?id=42&sort=desc#top';

  assert.equal(fmt.escapeUrl(url), url);
});

test('user mention is a link to max://user', () => {
  assert.equal(fmt.mention('Иван', 42), '[Иван](max://user/42)');
  assert.equal(fmt.mentionHtml('Иван', 42), '<a href="max://user/42">Иван</a>');
});

test('markdown escape covers the underline marker', () => {
  // Символ + уже входит в набор экранируемых, поэтому текст пользователя
  // не превращается в подчёркивание.
  assert.equal(fmt.escape('C++ и C++'), 'C\\+\\+ и C\\+\\+');
});
