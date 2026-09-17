import { Button, Input } from '@maxhub/max-ui';
import { useState } from 'react';

import { ApiError, type DomovoyApi } from '../api.js';
import { useToast } from '../toast.js';

export interface BindApartmentScreenProps {
  api: DomovoyApi;
  /** Позвать, когда квартира привязана: профиль изменился. */
  onBound: () => void;
}

/** Привязка к квартире по коду из квитанции. */
export const BindApartmentScreen = ({ api, onBound }: BindApartmentScreenProps) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const say = useToast();

  const bind = async (): Promise<void> => {
    if (code.trim().length === 0) {
      say('Введите код из квитанции', 'error');
      return;
    }

    setBusy(true);

    try {
      const flat = await api.bindApartment(code.trim());

      say(`Квартира ${flat.number} привязана`);
      onBound();
    } catch (reason) {
      say(reason instanceof ApiError ? reason.message : 'Не удалось привязать квартиру', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <label htmlFor="apartment-code">Код из квитанции</label>

      <Input
        className="field"
        id="apartment-code"
        value={code}
        maxLength={32}
        withClearButton={false}
        placeholder="KVMR4783"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
      />

      <Button type="button" stretched disabled={busy} onClick={() => void bind()}>
        {busy ? 'Проверяем…' : 'Привязать'}
      </Button>
    </section>
  );
};
