import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, type DomovoyApi } from '../api.js';
import { useHaptics } from '../haptics.js';
import { Domovoy } from './Domovoy.js';
import { ErrorText } from './ErrorText.js';

export interface ConsentProps {
  api: DomovoyApi;
  /** Документ открывается своим экраном: браузер для этого не нужен. */
  onDocument: (title: string, text: string) => void;
  onAccepted: () => void;
}

/**
 * Согласие с документами до того, как продукт что-то о человеке сохранит.
 * Политику обработки персональных данных оператор обязан открыть для чтения,
 * поэтому она лежит здесь же и читается внутри приложения, а не в браузере.
 */
export const Consent = ({ api, onDocument, onAccepted }: ConsentProps) => {
  const legal = useBridgeRequest(() => api.legal(), [api]);
  // Телефоны дома нужны до всякого согласия: аварию решают звонком.
  const contacts = useBridgeRequest(() => api.houseContacts().catch(() => null), [api]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const haptics = useHaptics();

  const documents = legal.data?.documents ?? [];
  const emergency = contacts.data?.service?.emergencyPhone ?? contacts.data?.service?.phone ?? '';

  const accept = async (): Promise<void> => {
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
    <div className="guide" role="dialog" aria-modal="true" aria-label="Документы">
      {/* Затемнение без закрытия: до согласия продукт не работает, а нажать мимо нельзя. */}
      <div className="guide-veil" aria-hidden="true" />

      <section className="guide-sheet consent">
        <Domovoy mood="walking" size={72} />

        <h2 className="guide-title">Документы</h2>
        <p className="guide-hint">
          Работаем с вашими данными по поручению управляющей компании. Что храним и как удалить,
          в документах ниже.
        </p>

        <div className="inline-keys consent-docs">
          {documents.map((document) => (
            <button
              key={document.slug}
              type="button"
              className="inline-btn"
              onClick={() => onDocument(document.title, document.text)}
            >
              {document.short}
            </button>
          ))}
        </div>

        {failed ? <ErrorText>{failed}</ErrorText> : null}

        <div className="confirm-keys">
          <button type="button" className="confirm-do" disabled={busy} onClick={() => void accept()}>
            {busy ? 'Сохраняем…' : 'Принимаю'}
          </button>
        </div>

        {emergency ? (
          <p className="hint aside consent-note">
            Аварийная служба круглосуточно: <a href={`tel:${emergency.replace(/[^+\d]/g, '')}`}>{emergency}</a>. Звонок
            не требует согласия.
          </p>
        ) : null}
      </section>
    </div>
  );
};
