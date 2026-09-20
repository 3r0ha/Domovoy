import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_LANGUAGE, legalLanguage, legalLanguages, type Language } from '@domovoy/i18n';

import { LEGAL_DOCUMENTS, formatLegal, legalDocument, legalDocuments, legalUpdated } from '../dist/index.js';

const slugs = (language?: Language): string[] => legalDocuments(language).map((document) => document.slug);

describe('документы по языкам', () => {
  it('без языка документы русские', () => {
    assert.deepEqual(legalDocuments(), LEGAL_DOCUMENTS);
    assert.equal(legalDocument('privacy')?.title, 'Политика обработки персональных данных');
    assert.equal(legalDocument('terms')?.title, 'Пользовательское соглашение');
  });

  it('язык без перевода откатывается на русский', () => {
    const unknown = 'qq' as Language;

    assert.deepEqual(legalDocuments(unknown), LEGAL_DOCUMENTS);
    assert.equal(legalLanguage(unknown), DEFAULT_LANGUAGE);
    assert.equal(legalDocument('privacy', unknown)?.title, legalDocument('privacy')?.title);
  });

  it('языком документа считается тот, на котором перевод есть', () => {
    for (const language of legalLanguages()) assert.equal(legalLanguage(language), language);

    assert.ok(legalLanguages().includes(DEFAULT_LANGUAGE), 'русская редакция обязательна');
  });

  it('набор документов одинаков во всех переведённых языках', () => {
    for (const language of legalLanguages()) {
      assert.deepEqual(slugs(language), slugs(), `в языке ${language} другой набор документов`);

      for (const document of legalDocuments(language)) {
        assert.ok(document.title.trim().length > 0, `в языке ${language} нет названия документа`);
        assert.ok(document.parts.length > 0, `в языке ${language} документ ${document.slug} пуст`);
      }
    }
  });

  it('документа с чужим именем нет ни на одном языке', () => {
    assert.equal(legalDocument('nothing'), undefined);

    for (const language of legalLanguages()) assert.equal(legalDocument('nothing', language), undefined);
  });

  it('подпись редакции идёт на языке документа', () => {
    const privacy = legalDocument('privacy');

    assert.ok(privacy);
    assert.equal(legalUpdated(), 'Редакция от 17 сентября 2026');
    assert.match(formatLegal(privacy), /^Политика обработки персональных данных\nРедакция от/u);

    for (const language of legalLanguages()) {
      assert.ok(legalUpdated(language).includes('2026'), `в языке ${language} потерялась дата редакции`);
    }
  });

  it('под переводом сказано, что юридическую силу имеет русская редакция', () => {
    const privacy = legalDocument('privacy', 'en');

    assert.ok(privacy);
    assert.match(formatLegal(privacy, 'en'), /The Russian version is the legally binding one/u);
    assert.doesNotMatch(formatLegal(legalDocument('privacy')!), /legally binding/u, 'в русской редакции оговорки нет');
  });

  it('на других языках дата цифрами: русский месяц в чужом тексте читается вставкой', () => {
    for (const language of legalLanguages()) {
      if (language === 'ru') continue;

      assert.match(legalUpdated(language), /17\.09\.2026/u, `в языке ${language} дата не цифрами`);
      assert.doesNotMatch(legalUpdated(language), /сентября/u);
    }
  });
});
