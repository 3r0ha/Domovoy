import { LEGAL_UPDATED, legalDocument } from '@domovoy/domain';

import { Hem } from './components/Ornament.js';
import { Foot, Top } from './components/Parts.js';

/**
 * Документ продукта на сайте: тот же текст, что в боте и в приложении.
 * Политику обработки персональных данных оператор обязан открыть для чтения,
 * поэтому страница статическая и ничего не требует от читателя.
 */
export const LegalPage = ({ slug }: { slug: string }) => {
  const document = legalDocument(slug);

  if (!document) return null;

  return (
    <>
      <Top />

      <main id="top" tabIndex={-1}>
        <article className="paper">
          <Hem open className="paper-hem" />

          <div className="wrap paper-inner">
            <h1 className="paper-title">{document.title}</h1>
            <p className="lead">{document.about}</p>
            <p className="paper-version">Редакция от {LEGAL_UPDATED}</p>

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
