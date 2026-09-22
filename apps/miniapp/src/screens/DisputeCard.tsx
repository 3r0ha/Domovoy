import { Button } from '@maxhub/max-ui';
import { useState } from 'react';

import { describeFailure, type DomovoyApi, type RequestView } from '../api.js';
import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
import { ErrorText } from './ErrorText.js';

/**
 * Несогласие с отказом. Отказ закрывает заявку, и до сих пор заявителю
 * оставалось завести такую же заново. Пересмотр даётся один раз, а отказ,
 * оставленный в силе, становится основанием для жилищной инспекции.
 */
export const DisputeCard = ({
  api,
  request,
  onChanged,
}: {
  api: DomovoyApi;
  request: RequestView;
  onChanged: () => void;
}) => {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const haptics = useHaptics();
  const t = useT();

  const send = async (): Promise<void> => {
    const said = comment.trim();

    if (!said) return;

    setBusy(true);
    setFailed(undefined);

    try {
      await api.disputeRequest(request.id, said);
      setComment('');
      haptics.done();
      onChanged();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="block dispute">
      <h2>{t('request.dispute.title')}</h2>
      <p className="hint">{t('request.dispute.about')}</p>

      {failed ? <ErrorText>{failed}</ErrorText> : null}

      <textarea
        aria-label={t('request.dispute.title')}
        placeholder={t('request.dispute.placeholder')}
        value={comment}
        rows={3}
        onChange={(event) => setComment(event.target.value)}
      />

      <Button type="button" stretched disabled={busy || comment.trim().length === 0} onClick={() => void send()}>
        {t('request.dispute.send')}
      </Button>
    </section>
  );
};
