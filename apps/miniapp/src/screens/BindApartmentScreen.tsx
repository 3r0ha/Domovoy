import { Button, CellSimple, Input } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { ApiError, type DomovoyApi, type HouseContactsView } from '../api.js';
import { useT } from '../i18n.js';
import { useToast } from '../toast.js';
import { ErrorText } from './ErrorText.js';
import { Group } from './Group.js';
import { IconChat, IconDocument, IconGlobe, IconPeople, IconPerson } from './icons.js';

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
  /** Смена языка: она доступна и до привязки. */
  onLanguage?: () => void;
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
  const t = useT();
  const phone = contacts?.service?.phone;
  const hours = contacts?.service?.hours;

  return (
    <Group title={t('bind.help')}>
      <CellSimple
        before={
          <span className="tile tile-grey">
            <IconDocument />
          </span>
        }
        title={t('bind.help.receipt')}
        subtitle={t('bind.help.receipt.hint')}
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
          subtitle={hours ? t('bind.help.company.hours', { часы: hours }) : t('bind.help.company')}
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
          title={t('bind.help.support')}
          subtitle={t('bind.help.support.hint')}
          separator
          height="compact"
          showChevron
          onClick={onSupport}
        />
      ) : null}
    </Group>
  );
};

/** Что открыто до привязки: профиль с документами, язык и, на проверке, роль. */
const Meanwhile = ({
  onProfile,
  onLanguage,
  onDemo,
}: {
  onProfile?: () => void;
  onLanguage?: () => void;
  onDemo?: () => void;
}) => {
  const t = useT();

  if (!onProfile && !onLanguage && !onDemo) return null;

  return (
    <Group>
      {onProfile ? (
        <CellSimple
          before={
            <span className="tile tile-grey">
              <IconPerson />
            </span>
          }
          title={t('bind.profile')}
          height="compact"
          showChevron
          onClick={onProfile}
        />
      ) : null}

      {onLanguage ? (
        <CellSimple
          before={
            <span className="tile tile-blue">
              <IconGlobe />
            </span>
          }
          title={t('sections.language.title')}
          subtitle={t('sections.language.hint')}
          separator={Boolean(onProfile)}
          height="compact"
          showChevron
          onClick={onLanguage}
        />
      ) : null}

      {onDemo ? (
        <CellSimple
          before={
            <span className="tile tile-green">
              <IconPeople />
            </span>
          }
          title={t('sections.demo.title')}
          subtitle={t('sections.demo.hint')}
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
  onLanguage,
  onDemo,
}: BindApartmentScreenProps) => {
  const t = useT();
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
      setError(t('bind.error.empty'));
      return;
    }

    // Длину проверяем до отправки: ответ сервера про неё человек ждёт зря.
    if (plain.length !== CODE_LENGTH) {
      setError(t('bind.error.length', { нужно: CODE_LENGTH, набрано: plain.length }));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const flat = await api.bindApartment(plain);

      say(t('bind.done', { номер: flat.number }));
      onBound();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('bind.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list">
      <section className="card">
        {/* Человек попал сюда первым экраном: он должен понять, куда попал и
            что ему тут дадут, а не увидеть одно поле для кода. */}
        <h2 className="lead">{house ? t('bind.title.house', { адрес: house }) : t('bind.title')}</h2>
        <p className="hint">{t('bind.about')}</p>

        <label htmlFor="apartment-code">{t('bind.code')}</label>

        <Input
          className="field"
          id="apartment-code"
          value={code}
          maxLength={TYPED_LENGTH}
          withClearButton={false}
          placeholder={t('bind.code.placeholder')}
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
          {busy ? t('bind.checking') : t('bind.do')}
        </Button>
      </section>

      <Help contacts={contacts.data ?? null} {...(onSupport ? { onSupport } : {})} />

      <Meanwhile
        {...(onProfile ? { onProfile } : {})}
        {...(onLanguage ? { onLanguage } : {})}
        {...(onDemo ? { onDemo } : {})}
      />
    </div>
  );
};
