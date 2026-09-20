import { Button, CellSimple, Input } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { ApiError, type DomovoyApi, type HouseContactsView } from '../api.js';
import { useToast } from '../toast.js';
import { ErrorText } from './ErrorText.js';
import { Group } from './Group.js';
import { IconChat, IconDocument, IconPeople, IconPerson } from './icons.js';

export interface BindApartmentScreenProps {
  api: DomovoyApi;
  /** У человека уже есть дом: контакты и поддержка ему доступны. */
  housed?: boolean;
  /** Позвать, когда квартира привязана: профиль изменился. */
  onBound: () => void;
  /** Уйти в поддержку: код теряют, и спросить его надо у кого-то живого. */
  onSupport?: () => void;
  /** Профиль и документы: жильцу без квартиры больше ничего не открыто. */
  onProfile?: () => void;
  /** Примерка роли на проверке. */
  onDemo?: () => void;
}

/** Сколько знаков в коде квартиры: столько же, сколько печатает квитанция. */
const CODE_LENGTH = 8;

/** Сколько знаков помещается в поле: код плюс разделители, которыми его разбивают. */
const TYPED_LENGTH = CODE_LENGTH + 4;

/** Код из квитанции набирают с пробелами и дефисами: разделители не его часть. */
const plainCode = (typed: string): string => typed.replaceAll(/[\s‐-―-]/gu, '').toUpperCase();

/** Куда звонить, если код не нашёлся. Контакты приходят вместе с домом. */
const Help = ({ contacts, onSupport }: { contacts: HouseContactsView | null; onSupport?: () => void }) => {
  const phone = contacts?.service?.phone;
  const hours = contacts?.service?.hours;

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

/** Что открыто до привязки: профиль с документами и, на проверке, роль. */
const Meanwhile = ({ onProfile, onDemo }: { onProfile?: () => void; onDemo?: () => void }) => {
  if (!onProfile && !onDemo) return null;

  return (
    <Group>
      {onProfile ? (
        <CellSimple
          before={
            <span className="tile tile-grey">
              <IconPerson />
            </span>
          }
          title="Профиль и документы"
          height="compact"
          showChevron
          onClick={onProfile}
        />
      ) : null}

      {onDemo ? (
        <CellSimple
          before={
            <span className="tile tile-green">
              <IconPeople />
            </span>
          }
          title="Роль"
          subtitle="Посмотреть продукт другой стороной"
          separator
          height="compact"
          showChevron
          onClick={onDemo}
        />
      ) : null}
    </Group>
  );
};

/** Привязка к квартире по коду из квитанции. */
export const BindApartmentScreen = ({
  api,
  housed = true,
  onBound,
  onSupport,
  onProfile,
  onDemo,
}: BindApartmentScreenProps) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const say = useToast();
  // Без дома контактов нет: у жильца до привязки их не спрашивают.
  const contacts = useBridgeRequest(
    (alive) => (housed ? api.until(alive).houseContacts().catch(() => null) : Promise.resolve(null)),
    [api, housed],
  );
  const house = contacts.data?.address ?? '';

  const bind = async (): Promise<void> => {
    // Второе нажатие, пока код проверяется, отправило бы его ещё раз.
    if (busy) return;

    const plain = plainCode(code);

    if (plain.length === 0) {
      setError('Введите код из квитанции');
      return;
    }

    // Длину проверяем до отправки: ответ сервера про неё человек ждёт зря.
    if (plain.length !== CODE_LENGTH) {
      setError(`В коде ${CODE_LENGTH} знаков, а вы набрали ${plain.length}`);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const flat = await api.bindApartment(plain);

      say(`Квартира ${flat.number} привязана`);
      onBound();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось привязать квартиру');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list">
      <section className="card">
        {/* Человек попал сюда первым экраном: он должен понять, куда попал и
            что ему тут дадут, а не увидеть одно поле для кода. */}
        <h2 className="lead">Домовой{house ? `, ${house}` : ''}</h2>
        <p className="hint">
          Здесь заявки в управляющую компанию, счёт за квартиру, счётчики, двери подъезда и собрания соседей.
        </p>

        <label htmlFor="apartment-code">Код из квитанции</label>
        <p className="hint">Он связывает вас с квартирой: без него показания и счёт не откроются</p>

        <Input
          className="field"
          id="apartment-code"
          value={code}
          maxLength={TYPED_LENGTH}
          withClearButton={false}
          placeholder="8 букв и цифр"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={error ? 'apartment-code-error' : undefined}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !busy) void bind();
          }}
        />

        {/* Причина отказа остаётся на экране: всплывающая плашка уходит раньше,
            чем человек успевает прочитать её и сверить код с квитанцией. */}
        {error ? (
          <ErrorText id="apartment-code-error">{error}</ErrorText>
        ) : null}

        <Button type="button" stretched disabled={busy} onClick={() => void bind()}>
          {busy ? 'Проверяем…' : 'Привязать'}
        </Button>
      </section>

      <Help contacts={contacts.data ?? null} {...(onSupport ? { onSupport } : {})} />

      <Meanwhile {...(onProfile ? { onProfile } : {})} {...(onDemo ? { onDemo } : {})} />
    </div>
  );
};
