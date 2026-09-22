import { Domovoy } from './components/Domovoy.js';
import { Hem, Mark } from './components/Ornament.js';
import { BOT_LINK, Foot, Shot, Top } from './components/Parts.js';
import { Rail } from './components/Rail.js';
import { useReveal } from './reveal.js';
import { useSnap } from './snap.js';
import { SECTIONS } from './sections.js';

const Scene = ({ index }: { index: number }) => {
  const section = SECTIONS[index]!;

  return (
    <section id={section.id} className={index % 2 ? 'scene scene-soft scene-right' : 'scene'}>
      <div className="wrap scene-inner">
        <div className="scene-text" data-reveal="text">
          <p className="eyebrow">{section.eyebrow}</p>
          <h2>{section.title}</h2>
          <p className="lead">{section.text}</p>
          <ul className="scene-points">
            {section.points.map((point) => (
              <li key={point}>
                <Mark size={9} />
                {point}
              </li>
            ))}
          </ul>
          <a className="cta" href={`/${section.id}/`}>
            {section.cta}
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path d="M3 8h9M8 3.5 12.5 8 8 12.5" />
            </svg>
          </a>
        </div>
        <div className="scene-art" data-reveal="art">
          <Shot name={section.shot} alt={section.alt} />
        </div>
      </div>
    </section>
  );
};

/** Сроки на тёмном фоне: та же сцена, что у остальных разделов, только другим тоном. */
const Dark = () => {
  const section = SECTIONS[2]!;

  return (
    <section id={section.id} className="dark">
      <div className="wrap dark-inner">
        <div className="dark-text" data-reveal="text">
          <p className="eyebrow">{section.eyebrow}</p>
          <h2>{section.title}</h2>
          <p className="lead">{section.text}</p>
          <ul className="scene-points">
            {section.points.map((point) => (
              <li key={point}>
                <Mark size={9} />
                {point}
              </li>
            ))}
          </ul>
          <a className="cta" href={`/${section.id}/`}>
            {section.cta}
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path d="M3 8h9M8 3.5 12.5 8 8 12.5" />
            </svg>
          </a>
        </div>

        <div className="dark-art" data-reveal="art">
          <Shot name={section.shot} alt={section.alt} />
          <Domovoy mood="alarmed" size="large" />
        </div>
      </div>
    </section>
  );
};

export const App = () => {
  useReveal();
  useSnap();

  return (
    <>
      <Top />
      <Rail />

      <main id="top" tabIndex={-1}>
        <section className="hero">
          <Hem open className="hero-hem hero-hem-open" />

          <div className="wrap hero-inner">
            <div className="hero-text">
              <h1>Домовой</h1>
              <p className="hero-claim">Дом целиком в одном чате</p>
              <p className="lead hero-lead">
                Заявки в управляющую организацию, собрания собственников и счета там же, где вы
                переписываетесь.
              </p>
            </div>

            <div className="hero-art">
              <Domovoy mood="greeting" size="hero" />
            </div>
          </div>

          <Hem className="hero-hem" />

          <div className="hero-foot">
            <a className="cta cta-max" href={BOT_LINK} target="_blank" rel="noreferrer">
              Открыть в MAX
            </a>

            <a className="cta" href="#request">
              Посмотреть, как это работает
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M8 3v9M3.5 8 8 12.5 12.5 8" />
              </svg>
            </a>
          </div>
        </section>

        <Scene index={0} />
        <Scene index={1} />

        <Dark />

        {SECTIONS.slice(3).map((section, index) => (
          <Scene key={section.id} index={index + 3} />
        ))}

        <section className="final">
          <div className="wrap final-inner" data-reveal="text">
            <h2>Домовой открывается в MAX</h2>
            <p className="lead">
              На странице показана часть продукта. Заявки, показания, собрания и работа смены
              идут в боте и мини-приложении.
            </p>

            <div className="final-acts">
              <a className="cta cta-max" href={BOT_LINK} target="_blank" rel="noreferrer">
                Открыть в MAX
              </a>

              <a className="cta" href="/request/">
                Разделы продукта
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                  <path d="M3 8h9M8 3.5 12.5 8 8 12.5" />
                </svg>
              </a>
            </div>

            <Domovoy mood="sleeping-sitting" size="small" />
          </div>
        </section>
      </main>

      <Foot />
    </>
  );
};
