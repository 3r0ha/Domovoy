import { Button, CellSimple, Input } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { ApiError, type DomovoyApi } from '../api.js';
import { useToast } from '../toast.js';
import { Group } from './Group.js';
import { IconChat, IconDocument, IconPerson } from './icons.js';

export interface BindApartmentScreenProps {
  api: DomovoyApi;
  /** Позвать, когда квартира привязана: профиль изменился. */
  onBound: () => void;
  /** Уйти в поддержку: код теряют, и спросить его надо у кого-то живого. */
  onSupport?: () => void;
}

/** Куда звонить, если код не нашёлся. Контакты приходят вместе с домом. */
const Help = ({ api, onSupport }: { api: DomovoyApi; onSupport?: () => void }) => {
  const contacts = useBridgeRequest(() => api.houseContacts().catch(() => null), [api]);
  const phone = contacts.data?.service?.phone;
  const hours = contacts.data?.service?.hours;

  return (
    <Group title="Не нашли код?">
      <CellSimple
        before={
          <span className="tile tile-grey">
            <IconDocument />
          </span>
        }
        title="Код напечатан в квитанции"
        subtitle="Восемь букв и цифр рядом с номером лицевого счёта"
        height="compact"
      />

      {phone ? (
        <CellSimple
          before={
            <span className="tile tile-teal">
              <IconPerson />
            </span>
          }
          title={phone}
          subtitle={hours ? `Управляющая компания, ${hours}` : 'Управляющая компания'}
          separator
          height="compact"
          onClick={() => {
            globalThis.location.href = `tel:${phone}`;
          }}
        />
      ) : null}

      {onSupport ? (
        <CellSimple
          before={
            <span className="tile tile-blue">
              <IconChat />
            </span>
          }
          title="Написать в поддержку"
          subtitle="Код пришлют в переписке"
          separator
          height="compact"
          showChevron
          onClick={onSupport}
        />
      ) : null}
    </Group>
  );
};

/** Привязка к квартире по коду из квитанции. */
export const BindApartmentScreen = ({ api, onBound, onSupport }: BindApartmentScreenProps) => {
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
    <div className="list">
      <section className="card">
        <label htmlFor="apartment-code">Код из квитанции</label>
        <p className="hint">Он связывает вас с квартирой: без него показания и счёт не откроются</p>

        <Input
          className="field"
          id="apartment-code"
          value={code}
          maxLength={32}
          withClearButton={false}
          placeholder="8 букв и цифр"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void bind();
          }}
        />

        <Button type="button" stretched disabled={busy} onClick={() => void bind()}>
          {busy ? 'Проверяем…' : 'Привязать'}
        </Button>
      </section>

      <Help api={api} {...(onSupport ? { onSupport } : {})} />
    </div>
  );
};
