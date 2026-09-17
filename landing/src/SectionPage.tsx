import type { CSSProperties } from 'react';

import { Domovoy } from './components/Domovoy.js';
import { Hem, Mark } from './components/Ornament.js';
import { Foot, Shot, Top } from './components/Parts.js';
import { useReveal } from './reveal.js';
import { useSnap } from './snap.js';
import { SECTIONS } from './sections.js';

export const SectionPage = ({ id }: { id: string }) => {
  useReveal();
  useSnap();

  const index = SECTIONS.findIndex((item) => item.id === id);
  const section = SECTIONS[index];

  if (!section) {
    return (
      <>
        <Top />
        <main id="top" className="page-hero wrap">
          <h1>Такого раздела нет</h1>
          <p className="lead">
            <a href="/">Вернуться на главную</a>
          </p>
        </main>
        <Foot />
      </>
    );
  }

  const previous = SECTIONS[(index - 1 + SECTIONS.length) % SECTIONS.length]!;
  const next = SECTIONS[(index + 1) % SECTIONS.length]!;
  const plainFirst = section.chapters[0] !== undefined && section.chapters[0].shot === undefined;

  return (
    <>
      <Top current={section.id} />

      <main id="top">
        <section className={plainFirst ? 'page-hero page-hero-tall' : 'page-hero'}>
          <Hem open className="page-hem page-hem-open" />
          <div className="wrap page-hero-inner">
            <div className="page-hero-text">
              <p className="eyebrow">{section.eyebrow}</p>
              <h1>{section.pageTitle}</h1>
              <p className="lead page-lead">{section.pageLead}</p>
            </div>
            {section.mood ? <Domovoy mood={section.mood} size="large" /> : null}
          </div>
          <Hem className="page-hem" />


          {plainFirst ? (
            <a className="page-down" href="#дальше" aria-label="Листать дальше">
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                <path d="M12 4.5v14M5.5 12.5 12 19l6.5-6.5" />
              </svg>
            </a>
          ) : null}
        </section>

        {section.chapters.map((chapter, at) => {
          const plain = !chapter.shot;
          const tone = at % 2 ? ' scene-soft' : '';

          return (
            <section
              key={chapter.title}
              {...(at === 0 ? { id: 'дальше' } : {})}
              className={plain ? `scene chapter chapter-plain${tone}` : `scene chapter${tone}${at % 2 ? ' scene-right' : ''}`}
            >
              <div className={plain ? 'wrap chapter-plain-inner' : 'wrap scene-inner'}>
                <div className="scene-text" data-reveal="text">
                  <h2>{chapter.title}</h2>
                  <p className="lead">{chapter.text}</p>
                </div>

                {plain ? (
                  chapter.lines ? (
                    <ul className="chapter-lines" data-reveal="text">
                      {chapter.lines.map((line) => (
                        <li key={line}>
                          <Mark size={9} />
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : null
                ) : (
                  <div className="scene-art" data-reveal="art">
                    <Shot name={chapter.shot!} alt={chapter.alt ?? chapter.title} />
                  </div>
                )}
              </div>
            </section>
          );
        })}

        <section className="extras">
          <div className="wrap">
            <h2 className="extras-title" data-reveal="text">И ещё в этом разделе</h2>
            <ul className="extras-list">
              {section.extras.map((extra, at) => (
                <li key={extra.title} data-reveal="text" style={{ '--at': at } as CSSProperties}>
                  <h3>
                    <Mark size={11} />
                    {extra.title}
                  </h3>
                  <p>{extra.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="page-end">
          <div className="wrap">
            <nav className="page-nav">
              <a className="page-step" href={`/${previous.id}/`}>
                <svg viewBox="0 0 20 20" width="19" height="19" aria-hidden="true">
                  <path d="M13 3.5 6.5 10l6.5 6.5" />
                </svg>
                <b>{previous.pageTitle}</b>
              </a>
              <a className="ghost" href="/">
                На главную
              </a>
              <a className="page-step page-step-next" href={`/${next.id}/`}>
                <b>{next.pageTitle}</b>
                <svg viewBox="0 0 20 20" width="19" height="19" aria-hidden="true">
                  <path d="M7 3.5 13.5 10 7 16.5" />
                </svg>
              </a>
            </nav>
          </div>
        </section>
      </main>

      <Foot />
    </>
  );
};
