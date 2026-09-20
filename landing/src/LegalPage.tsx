import { legalDocument, legalUpdated } from '@domovoy/domain';
import {
  DEFAULT_LANGUAGE,
  languageTitle,
  legalLanguages,
  legalNotesFor,
  type Language,
} from '@domovoy/i18n';

import { Hem } from './components/Ornament.js';
import { Foot, Top } from './components/Parts.js';

/** Адрес документа: русская редакция лежит в корне, у остальных языков свой каталог. */
const linkTo = (slug: string, language: Language): string =>
  language === DEFAULT_LANGUAGE ? `/${slug}/` : `/${language}/${slug}/`;

/**
 * Документ продукта на сайте: тот же текст, что в боте и в приложении.
 * Политику обработки персональных данных оператор обязан открыть для чтения,
 * поэтому страница статическая и ничего не требует от читателя.
 */
export const LegalPage = ({ slug, language = DEFAULT_LANGUAGE }: { slug: string; language?: Language }) => {
  const document = legalDocument(slug, language);
  const notes = legalNotesFor(language);
  const languages = legalLanguages();

  if (!document) return null;

  return (
    <>
      <Top />

      <main id="top" tabIndex={-1}>
        <article className="paper">
          <Hem open className="paper-hem" />

          <div className="wrap paper-inner">
            {languages.length > 1 ? (
              <nav className="paper-langs" aria-label={notes.languages}>
                {languages.map((code) => (
                  <a
                    key={code}
                    className={code === language ? 'paper-lang paper-lang-on' : 'paper-lang'}
                    href={linkTo(slug, code)}
                    hrefLang={code}
                    lang={code}
                    aria-current={code === language ? 'page' : undefined}
                  >
                    {languageTitle(code)}
                  </a>
                ))}
              </nav>
            ) : null}

            <h1 className="paper-title">{document.title}</h1>
            <p className="lead">{document.about}</p>
            <p className="paper-version">{legalUpdated(language)}</p>

            {language === DEFAULT_LANGUAGE ? null : (
              <p className="paper-prevails">
                <a href={linkTo(slug, DEFAULT_LANGUAGE)} hrefLang={DEFAULT_LANGUAGE}>
                  {notes.prevails}
                </a>
              </p>
            )}

            {document.parts.map((part) => (
              <section key={part.heading} className="paper-part">
                <h2>{part.heading}</h2>
                {part.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </section>
            ))}
          </div>

          <Hem className="paper-hem" />
        </article>
      </main>

      <Foot />
    </>
  );
};
