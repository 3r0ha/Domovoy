import { Button, Input } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, type DomovoyApi } from '../api.js';
import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
import { ErrorText } from './ErrorText.js';

/**
 * Дом, которого в продукте ещё нет. Человек, чья управляющая организация
 * не подключена, упирался в тупик: кода из квитанции ему взять неоткуда,
 * и продукт для него пустой. Он оставляет адрес, а компания видит список.
 */
export const ConnectHouse = ({ api }: { api: DomovoyApi }) => {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const haptics = useHaptics();
  const t = useT();

  const asked = useBridgeRequest((alive) => api.until(alive).connection(), [api]);
  const known = saved ?? asked.data?.address;

  const send = async (): Promise<void> => {
    const said = address.trim();

    if (!said) return;

    setBusy(true);
    setFailed(undefined);

    try {
      const result = await api.askToConnect(said);

      setSaved(result.address);
      setAddress('');
      haptics.done();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="block connect">
      <h2>{t('connect.title')}</h2>
      <p className="hint">{t('connect.about')}</p>

      {known ? <p>{t('connect.saved', { адрес: known })}</p> : null}

      {failed ? <ErrorText>{failed}</ErrorText> : null}

      <Input
        className="field"
        value={address}
        placeholder={t('connect.placeholder')}
        aria-label={t('connect.title')}
        onChange={(event) => setAddress(event.target.value)}
      />

      <Button type="button" stretched disabled={busy || address.trim().length === 0} onClick={() => void send()}>
        {t('connect.send')}
      </Button>
    </section>
  );
};
