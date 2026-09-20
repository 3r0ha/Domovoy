import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useTrapped } from './focus.js';
import { useT } from './i18n.js';

type Show = (source: string, alt?: string) => void;

const ViewerContext = createContext<Show>(() => undefined);

/** Открыть снимок во весь экран. */
export const useViewer = (): Show => useContext(ViewerContext);

/** Снимок целиком: на маленькой картинке в переписке половины не разглядеть. */
export const Viewer = ({ children }: { children: ReactNode }) => {
  const [shown, setShown] = useState<{ source: string; alt: string } | null>(null);
  const box = useTrapped<HTMLDivElement>(shown !== null);
  const t = useT();

  useEffect(() => {
    if (!shown) return undefined;

    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShown(null);
    };

    globalThis.addEventListener('keydown', close);

    return () => globalThis.removeEventListener('keydown', close);
  }, [shown]);

  return (
    <ViewerContext.Provider value={(source, alt) => setShown({ source, alt: alt ?? '' })}>
      {children}

      {shown ? (
        <div
          className="viewer"
          role="dialog"
          aria-modal="true"
          aria-label={shown.alt || t('viewer.title')}
          ref={box}
          onClick={() => setShown(null)}
        >
          {/* Выход виден, а не угадывается: касание мимо снимка закрывает его
              не на всяком клиенте, а искать его вслепую пожилому человеку нечем. */}
          <button
            type="button"
            className="viewer-close"
            aria-label={t('viewer.close')}
            onClick={(event) => {
              event.stopPropagation();
              setShown(null);
            }}
          >
            ×
          </button>

          <img src={shown.source} alt={shown.alt} />
        </div>
      ) : null}
    </ViewerContext.Provider>
  );
};
