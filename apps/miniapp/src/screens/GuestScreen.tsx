import { Button } from '@maxhub/max-ui';
import { useBridge, useSupports } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, formatTime, type DeviceView, type DomovoyApi, type GuestCodeView } from '../api.js';
import { ErrorText } from './ErrorText.js';

export interface GuestScreenProps {
  api: DomovoyApi;
  device: DeviceView;
}

/** Код для гостя. */
export const GuestScreen = ({ api, device }: GuestScreenProps) => {
  const bridge = useBridge();
  const toMax = useSupports('shareToMax');
  const native = useSupports('shareNative');
  const [code, setCode] = useState<GuestCodeView | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (what: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await what();
    } catch (reason: unknown) {
      setError(describeFailure(reason));
    } finally {
      setBusy(false);
    }
  };

  const issue = (): Promise<void> =>
    run(async () => {
      setCode(await api.inviteGuest(device.id));
      setRevoked(false);
    });

  const revoke = (): Promise<void> =>
    run(async () => {
      if (!code) return;

      await api.revokeGuestCode(code.code);
      setRevoked(true);
    });

  if (!code) {
    return (
      <section className="block guest">
        <p className="hint">Код на 15 минут, на один вход</p>

        <Button type="button" stretched size="large" disabled={busy} onClick={() => void issue()}>
          {busy ? 'Выдаём…' : 'Выдать код'}
        </Button>

        {error ? <ErrorText>{error}</ErrorText> : null}
      </section>
    );
  }

  if (revoked) {
    return (
      <section className="block guest">
        <p className="guest-code guest-code-off">{code.code}</p>
        <p className="hint">код отозван</p>

        <Button type="button" stretched disabled={busy} onClick={() => void issue()}>
          Выдать новый
        </Button>

        {error ? <ErrorText>{error}</ErrorText> : null}
      </section>
    );
  }

  const text = `Код от двери «${device.title}»: ${code.code}. Действует до ${formatTime(code.expiresAt)}.`;

  const share = async (): Promise<void> => {
    try {
      await (toMax ? bridge.shareMaxContent({ text }) : bridge.shareContent({ text }));
    } catch {
      return;
    }
  };

  return (
    <section className="block guest">
      <p className="guest-code">{code.code}</p>
      <p className="hint">Действует до {formatTime(code.expiresAt)}, один раз</p>

      {toMax || native ? (
        <Button type="button" stretched size="large" onClick={() => void share()}>
          Отправить
        </Button>
      ) : null}

      <Button type="button" stretched variant="secondary" disabled={busy} onClick={() => void revoke()}>
        {busy ? 'Отзываем…' : 'Отозвать'}
      </Button>

      {error ? <ErrorText>{error}</ErrorText> : null}
    </section>
  );
};
