import { Avatar, CellAction, CellList, CellSimple, Switch } from '@maxhub/max-ui';
import { useBridge, useBridgeRequest, useSupports } from '@maxkit/react';
import { useState } from 'react';

import { ApiError, formatDay, formatPhone, initial, type DomovoyApi, type NoticeView } from '../api.js';
import { Confirm } from './Confirm.js';
import { ErrorText } from './ErrorText.js';
import { Group } from './Group.js';

export interface ProfileScreenProps {
  api: DomovoyApi;
  displayName: string;
  /** Квартира привязана. */
  bound: boolean;
  /** Где человек живёт: «Квартира 1 · ул. Ленина, 15». */
  where?: string;
  /** Телефон, который человек уже оставил. */
  phone?: string;
  /** Полномочия старшего по подъезду и их срок. */
  elder?: { entrance: number; until: string };
  /** Сотрудник и его дежурство: ночные заявки идут дежурному. */
  duty?: { residentId: string; onDuty: boolean };
  /** Своя квартира: её отвязывают, когда переехали или продали. */
  flat?: { residentId: string; apartmentId: string; title: string };
  /** Открыть длинный текст своим экраном. */
  onDocument: (title: string, text: string) => void;
  onForgotten: () => void;
  /** Квартира отвязана: сессию нужно перечитать. */
  onUnbound?: () => void;
  /** Телефон сохранён или убран: профиль в сессии узнаёт об этом сразу. */
  onPhone?: (phone: string) => void;
}

/** Профиль: данные человека, настройки уведомлений и удаление профиля. */
export const ProfileScreen = ({
  api,
  displayName,
  bound,
  where,
  phone,
  elder,
  duty,
  flat,
  onDocument,
  onForgotten,
  onUnbound,
  onPhone,
}: ProfileScreenProps) => {
  const bridge = useBridge();
  const canShareContact = useSupports('requestContact');
  const notices = useBridgeRequest((alive) => api.until(alive).notices(), [api]);
  const legal = useBridgeRequest((alive) => api.until(alive).legal(), [api]);

  const [own, setOwn] = useState<NoticeView[] | null>(null);
  const [onDuty, setOnDuty] = useState(duty?.onDuty ?? false);
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = own ?? notices.data ?? [];
  const number = savedPhone ?? phone ?? '';

  const run = async (what: () => Promise<void>): Promise<void> => {
    // Второе нажатие до ответа сервера ничего не отправляет и не открывает.
    if (working) return;

    setWorking(true);
    setError(null);

    try {
      await what();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не получилось');
    } finally {
      setWorking(false);
    }
  };

  /** Дежурство переключается на месте: смена принимает его с телефона. */
  const switchDuty = (): Promise<void> =>
    run(async () => {
      if (!duty) return;

      const next = !onDuty;

      setOnDuty(next);

      try {
        await api.setDuty(duty.residentId, next);
      } catch (reason) {
        setOnDuty(!next);
        throw reason;
      }
    });

  const toggle = (notice: NoticeView): Promise<void> =>
    run(async () => {
      const before = list;

      setOwn(list.map((item) => (item.kind === notice.kind ? { ...item, on: !item.on } : item)));

      try {
        setOwn(await api.setNotice(notice.kind, !notice.on));
      } catch (reason) {
        setOwn(before);
        throw reason;
      }
    });

  const share = (): Promise<void> =>
    run(async () => {
      const saved = (await api.saveContact(await bridge.requestContact())).phone;

      setSavedPhone(saved);
      onPhone?.(saved);
    });

  const forgetPhone = (): Promise<void> =>
    run(async () => {
      await api.forgetContact();
      setSavedPhone('');
      onPhone?.('');
    });

  const unbind = (): Promise<void> =>
    run(async () => {
      if (!flat) return;

      await api.unbindResident(flat.residentId, flat.apartmentId);
      setLeaving(false);
      onUnbound?.();
    });

  const showData = (): Promise<void> =>
    run(async () => onDocument('Мои данные', await api.personalData()));

  /** Документ продукта: открывается своим экраном, без браузера. Список уже прочитан. */
  const showLegal = (slug: string): Promise<void> =>
    run(async () => {
      const found = (legal.data?.documents ?? []).find((document) => document.slug === slug);

      if (found) onDocument(found.title, found.text);
    });

  const forget = (): Promise<void> =>
    run(async () => {
      setBusy(true);

      try {
        await api.forgetMe();
        onForgotten();
      } finally {
        setBusy(false);
      }
    });

  return (
    <div className="list">
      <CellList mode="island">
        <CellSimple
          before={
            <Avatar.Container size={40}>
              <Avatar.Text>{initial(displayName)}</Avatar.Text>
            </Avatar.Container>
          }
          title={displayName}
          subtitle={where ?? (bound ? 'Квартира привязана' : 'Квартира не привязана')}
        />

        {elder ? (
          <CellSimple
            title={`Старший по подъезду ${elder.entrance}`}
            subtitle={`Полномочия до ${formatDay(elder.until)}`}
            separator
            height="compact"
          />
        ) : null}
      </CellList>

      {duty ? (
        <Group title="Смена">
          <CellSimple
            title="Я на дежурстве"
            subtitle={onDuty ? 'Ночные заявки идут вам' : 'Ночные заявки уйдут всей смене'}
            after={<Switch checked={onDuty} onChange={() => void switchDuty()} aria-label="Дежурство" />}
            height="compact"
          />
        </Group>
      ) : null}

      <CellList mode="island">
        {canShareContact ? (
          <CellSimple
            title="Телефон"
            subtitle={number ? formatPhone(number) : 'Не указан'}
            showChevron={!number}
            {...(number ? {} : { onClick: () => void share() })}
          />
        ) : null}

        <CellSimple
          className="row-split"
          title="Мои данные"
          subtitle="Заявки, показания и голоса"
          separator={canShareContact}
          showChevron
          onClick={() => void showData()}
        />

        {(legal.data?.documents ?? []).map((document) => (
          <CellSimple
            key={document.slug}
            className="row-split"
            title={document.short}
            separator
            showChevron
            onClick={() => void showLegal(document.slug)}
          />
        ))}
      </CellList>

      {list.length > 0 ? (
        <>
          <Group title="Что присылать">
            {list.map((notice, index) => (
              <CellSimple
                key={notice.kind}
                title={notice.title}
                after={<Switch checked={notice.on} onChange={() => void toggle(notice)} aria-label={notice.title} />}
                separator={index > 0}
                height="compact"
              />
            ))}
          </Group>

          <p className="hint aside">Об авариях и своих заявках сообщаем всегда</p>
        </>
      ) : null}

      {notices.error ? <ErrorText>Настройки уведомлений не загрузились</ErrorText> : null}

      {flat ? (
        <CellList mode="island">
          <CellSimple
            className="row-split"
            title="Отвязать квартиру"
            showChevron
            onClick={() => setLeaving(true)}
          />
        </CellList>
      ) : null}

      {flat && leaving ? (
        <Confirm
          title={`Отвязать ${flat.title.toLowerCase()}?`}
          text="Заявки и показания останутся у дома, привязать снова можно кодом из квитанции."
          confirmLabel="Отвязать"
          busyLabel="Отвязываем…"
          busy={working}
          danger
          onConfirm={() => void unbind()}
          onCancel={() => setLeaving(false)}
        />
      ) : null}

      {number ? (
        <CellList mode="island">
          <CellAction mode="secondary" onClick={() => void forgetPhone()}>
            Убрать телефон
          </CellAction>
        </CellList>
      ) : null}

      <button type="button" className="link danger-link" onClick={() => setConfirming(true)}>
        Удалить профиль
      </button>

      {confirming ? (
        <Confirm
          title="Удалить профиль?"
          text={`${bound ? 'Квартира отвяжется. ' : ''}Заявки и показания останутся у дома.`}
          confirmLabel="Удалить"
          busyLabel="Удаляем…"
          busy={busy}
          danger
          onConfirm={() => void forget()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
};
