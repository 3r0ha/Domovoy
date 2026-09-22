import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, type DocumentStructure, type DomovoyApi } from '../api.js';
import { structureOf } from '../views.js';
import { useTrapped } from '../focus.js';
import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
import { Domovoy } from './Domovoy.js';
import { ErrorText } from './ErrorText.js';
import { RetryLink } from './Retry.js';

export interface ConsentProps {
  api: DomovoyApi;
  /** Документ открывается своим экраном: браузер для этого не нужен. */
  onDocument: (title: string, text: string, structure?: DocumentStructure) => void;
  onAccepted: () => void;
}

/**
 * Согласие с документами до того, как продукт что-то о человеке сохранит.
 * Политику обработки персональных данных оператор обязан открыть для чтения,
 * поэтому она лежит здесь же и читается внутри приложения, а не в браузере.
 */
export const Consent = ({ api, onDocument, onAccepted }: ConsentProps) => {
  const legal = useBridgeRequest((alive) => api.until(alive).legal(), [api]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const haptics = useHaptics();
  const t = useT();
  const sheet = useTrapped<HTMLElement>(true);

  const documents = legal.data?.documents ?? [];
  // Согласиться можно только с тем, что человек мог открыть и прочитать.
  const readable = documents.length > 0;

  const accept = async (): Promise<void> => {
    if (busy || !readable) return;

    setBusy(true);
    setFailed(null);

    try {
      await api.acceptLegal();
      haptics.done();
      onAccepted();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="guide" role="dialog" aria-modal="true" aria-label={t('consent.title')}>
      {/* Затемнение без закрытия: до согласия продукт не работает, а нажать мимо нельзя. */}
      <div className="guide-veil" aria-hidden="true" />

      <section className="guide-sheet consent" ref={sheet}>
        <Domovoy mood="walking" size={72} />

        <h2 className="guide-title">{t('consent.title')}</h2>
        <p className="guide-hint">{t('consent.hint')}</p>

        <div className="inline-keys consent-docs">
          {documents.map((document) => (
            <button
              key={document.slug}
              type="button"
              className="inline-btn"
              onClick={() => onDocument(document.title, document.text, structureOf(document))}
            >
              {document.short}
            </button>
          ))}
        </div>

        {legal.loading && !readable ? <p className="hint">{t('consent.loading')}</p> : null}

        {!readable && !legal.loading ? (
          <RetryLink title={t('consent.failed')} onRetry={legal.reload} />
        ) : null}

        {failed ? <ErrorText>{failed}</ErrorText> : null}

        <div className="confirm-keys">
          <button type="button" className="confirm-do" disabled={busy || !readable} onClick={() => void accept()}>
            {busy ? t('consent.saving') : t('consent.accept')}
          </button>
        </div>
      </section>
    </div>
  );
};
