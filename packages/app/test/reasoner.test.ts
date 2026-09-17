import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { understandRequest, type ReasonedFields, type Reasoner } from '../dist/reasoner.js';

const answering = (fields: ReasonedFields | undefined): Reasoner => ({
  understand: () => Promise.resolve(fields),
});

const broken: Reasoner = { understand: () => Promise.reject(new Error('служба недоступна')) };

describe('разбор обращения', () => {
  it('без модели категорию подсказывают ключевые слова', async () => {
    const read = await understandRequest('Течёт кран на кухне');

    assert.equal(read.category, 'plumbing');
    assert.equal(read.priority, 'normal');
  });

  it('модель понимает то, чего не знают подстроки', async () => {
    const plain = await understandRequest('Из-под ванны капает');

    assert.equal(plain.category, 'other');

    const read = await understandRequest('Из-под ванны капает', answering({ category: 'plumbing' }));

    assert.equal(read.category, 'plumbing');
  });

  it('недоступная модель заявку не задерживает', async () => {
    const read = await understandRequest('Не работает лифт', broken);

    assert.equal(read.category, 'elevator');
  });

  it('несуществующая категория отбрасывается', async () => {
    const read = await understandRequest('Не работает лифт', answering({ category: 'сантехника' }));

    assert.equal(read.category, 'elevator');
  });

  it('пустой ответ отбрасывается', async () => {
    const read = await understandRequest('Не работает лифт', answering(undefined));

    assert.equal(read.category, 'elevator');
  });

  it('срочность по словам модель не снижает', async () => {
    const read = await understandRequest('Прорыв трубы в подвале', answering({ priority: 'planned' }));

    assert.equal(read.priority, 'emergency');
  });

  it('срочность модель поднять может', async () => {
    const read = await understandRequest('В подъезде пахнет чем-то странным', answering({ priority: 'emergency' }));

    assert.equal(read.priority, 'emergency');
  });

  it('заголовок длиннее строки списка не берётся', async () => {
    const read = await understandRequest('Не горит лампа', answering({ title: 'а'.repeat(81) }));

    assert.equal(read.title, undefined);
  });

  it('вопрос доходит до вызывающего', async () => {
    const read = await understandRequest('Не работает', answering({ question: 'Что именно не работает?' }));

    assert.equal(read.question, 'Что именно не работает?');
  });
});
