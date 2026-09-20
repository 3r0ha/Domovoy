import { Button, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import type { Translate } from '@domovoy/i18n';

import {
  ApiError,
  formatDay,
  formatPublished,
  formatSince,
  plural,
  type DomovoyApi,
  type HouseContactsView,
  type TicketView,
} from '../api.js';
import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
import { usePhotos } from '../use-photos.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Attachments } from './Attachments.js';
import { Composer } from './Composer.js';
import { Original } from './Original.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconChat, IconPerson, IconWarning } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface SupportScreenProps {
  api: DomovoyApi;
  /** Смена отвечает на вопросы жильцов, жилец их задаёт. */
  staff?: boolean;
  /** Вернуться туда, откуда открыли поддержку. Без него раздел стоит корнем. */
  onBack?: () => void;
  /** Как называется экран под этим: «Ещё». */
  backTitle?: string;
  /** Вопрос задан, отвечен или снят: значки на вкладках считаются заново. */
  onChanged?: () => void;
}

/** Кто спросил и сколько ждёт: смене это нужно до открытия переписки. */
const asker = (ticket: TicketView): string =>
  [
    [ticket.authorName ?? 'Жилец', ticket.apartment === undefined ? '' : `кв. ${ticket.apartment}`]
      .filter(Boolean)
      .join(', '),
    ticket.overdue === true
      ? `срок ответа истёк · ждёт ${formatSince(ticket.waitingSince ?? ticket.createdAt)}`
      : ticket.waitingSince
        ? `ждёт ${formatSince(ticket.waitingSince)}`
        : ticket.statusTitle,
    // Срок ответа нормативный: смене нужно видеть, до какого числа отвечать.
    ticket.answerDueAt && ticket.overdue !== true ? `ответ до ${formatDay(ticket.answerDueAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** Состояния обращения, которые продукт называет сам. */
const TICKET_STATUSES = ['open', 'answered', 'closed'];

/** Состояние обращения глазами жильца: со сроком ответа, пока он идёт. */
const state = (t: Translate, ticket: TicketView): string =>
  [
    TICKET_STATUSES.includes(ticket.status) ? t(`support.state.${ticket.status}`) : ticket.statusTitle,
    formatPublished(ticket.updatedAt),
    ticket.answerDueAt ? t('support.due', { дата: formatDay(ticket.answerDueAt) }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** Контакты дома: ответственный от компании и кто сейчас дежурит. */
const Contacts = ({ contacts }: { contacts: HouseContactsView }) => {
  const t = useT();
  const { contact, duty, service } = contacts;
  const call = (phone: string): void => void globalThis.open(`tel:${phone}`, '_self');

  return (
    <Group title={t('support.contacts')}>
      {service?.emergencyPhone ? (
        <CellSimple
          before={
            <span className="tile tile-red">
              <IconWarning />
            </span>
          }
          title={t('support.emergency')}
          subtitle={t('support.emergency.hours', { телефон: service.emergencyPhone })}
          height="compact"
          showChevron
          onClick={() => call(service.emergencyPhone ?? '')}
        />
      ) : null}

      <CellSimple
        before={
          <span className="tile tile-teal">
            <IconPerson />
          </span>
        }
        title={contact?.name ?? contacts.managementCompany ?? t('support.company')}
        subtitle={contact?.role ?? contacts.address}
        height="compact"
        separator={Boolean(service?.emergencyPhone)}
      />

      {contact?.phone ? (
        <CellSimple
          title={t('support.call')}
          subtitle={contact.phone}
          height="compact"
          separator
          showChevron
          onClick={() => globalThis.open(`tel:${contact.phone ?? ''}`, '_self')}
        />
      ) : null}

      {contact?.email ? (
        <CellSimple
          title={t('support.email')}
          subtitle={contact.email}
          height="compact"
          separator
          showChevron
          onClick={() => globalThis.open(`mailto:${contact.email ?? ''}`, '_self')}
        />
      ) : null}

      {service?.phone || service?.hours ? (
        <CellSimple
          title={t('support.service')}
          subtitle={[service.phone, service.hours].filter(Boolean).join(' · ')}
          height="compact"
          separator
          {...(service.phone ? { showChevron: true, onClick: () => call(service.phone ?? '') } : {})}
        />
      ) : null}

      {service?.office ? (
        <CellSimple
          title={t('support.office')}
          subtitle={[service.office, service.officeHours].filter(Boolean).join(' · ')}
          height="compact"
          separator
        />
      ) : null}

      {duty ? (
        <CellSimple
          title={t('support.duty')}
          subtitle={duty.phone ? `${duty.displayName} · ${duty.phone}` : duty.displayName}
          height="compact"
          separator
          {...(duty.phone ? { showChevron: true, onClick: () => globalThis.open(`tel:${duty.phone ?? ''}`, '_self') } : {})}
        />
      ) : null}
    </Group>
  );
};

/** Переписка по одному обращению. */
const Thread = ({
  api,
  ticket,
  staff,
  onChanged,
  onBack,
}: {
  api: DomovoyApi;
  ticket: TicketView;
  staff?: boolean;
  onChanged: (ticket: TicketView) => void;
  onBack: () => void;
}) => {
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const haptics = useHaptics();
  const photos = usePhotos(api);
  const closed = ticket.status === 'closed';

  const run = async (what: () => Promise<TicketView>): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const saved = await what();

      haptics.done();
      setText('');
      photos.reset();
      onChanged(saved);
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : t('support.send.failed'));
    } finally {
      setBusy(false);
    }
  };

  const send = (): Promise<void> =>
    run(() =>
      staff
        ? api.answerSupport(ticket.id, text.trim(), photos.photos)
        : api.askSupport(text.trim(), ticket.id, photos.photos),
    );

  // Жилец снимает вопрос, когда получил ответ; смена закрывает переписку в любой момент.
  const canClose = staff || ticket.status === 'answered';

  return (
    <section className="chat">
      <button type="button" className="link back-link" onClick={onBack}>
        <span aria-hidden="true">‹</span> {t('support.all')}
      </button>

      {/* Кто спрашивает и к какому сроку ждёт ответа: это шапка переписки, а не первое сообщение. */}
      {staff ? <p className="hint chat-who">{asker(ticket)}</p> : null}

      <div className="chat-flow">
        {ticket.messages.map((message, index) => (
          <article key={`${message.at}-${index}`} className={message.own ? 'said said-own' : 'said'}>
            {message.own ? null : <span className="said-who">{message.authorName ?? t('support.company')}</span>}
            {message.text ? <p className="description">{message.text}</p> : null}
            <Original {...(message.original ? { original: message.original } : {})} staff={staff} />
            <Attachments api={api} items={message.attachments ?? []} alt={message.authorName ?? t('support.attachment')} />
            <time className="said-at">{formatPublished(message.at)}</time>
          </article>
        ))}
      </div>

      {closed ? (
        <p className="hint chat-closed">{t('support.closed')}</p>
      ) : (
        <div className="chat-foot">
          {error ? <ErrorText>{error}</ErrorText> : null}

          {/* Ответ прочитан и подошёл: снятый вопрос убирает значок из панели. */}
          {canClose ? (
            <button
              type="button"
              className="link chat-done"
              disabled={busy}
              onClick={() => void run(() => api.closeSupport(ticket.id))}
            >
              {staff ? 'Закрыть вопрос' : t('support.close')}
            </button>
          ) : null}

          <Composer
            api={api}
            id={`support-reply-${ticket.id}`}
            label={staff ? 'Ответ жильцу' : t('support.message')}
            placeholder={staff ? 'Ответ жильцу' : t('support.message')}
            value={text}
            busy={busy}
            photos={photos}
            onChange={setText}
            onSend={() => void send()}
          />
        </div>
      )}

    </section>
  );
};

/** Новый вопрос в управляющую компанию. */
const Ask = ({
  api,
  onAsked,
  onBack,
}: {
  api: DomovoyApi;
  onAsked: (ticket: TicketView) => void;
  onBack: () => void;
}) => {
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photos = usePhotos(api);
  const haptics = useHaptics();

  const ask = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const ticket = await api.askSupport(text.trim(), undefined, photos.photos);

      haptics.done();
      setText('');
      photos.reset();
      onAsked(ticket);
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : t('support.ask.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat">
      <button type="button" className="link back-link" onClick={onBack}>
        <span aria-hidden="true">‹</span> {t('support.all')}
      </button>

      <div className="chat-flow">
        <article className="said said-bot">
          <p className="description">{t('support.ask.hint')}</p>
        </article>
      </div>

      <div className="chat-foot">
        {error ? <ErrorText>{error}</ErrorText> : null}

        <Composer
          api={api}
          id="support-ask"
          label={t('support.ask.label')}
          placeholder={t('support.ask.label')}
          value={text}
          busy={busy}
          photos={photos}
          requireText
          onChange={setText}
          onSend={() => void ask()}
        />
      </div>
    </section>
  );
};

/** Поддержка: контакты дома и переписка с управляющей компанией. */
export const SupportScreen = ({ api, staff, onBack, backTitle, onChanged }: SupportScreenProps) => {
  const t = useT();
  const contacts = useBridgeRequest((alive) => api.until(alive).houseContacts(), [api]);
  const tickets = useBridgeRequest((alive) => api.until(alive).supportTickets(), [api]);
  const [changed, setChanged] = useState<TicketView[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const merged = [...changed, ...(tickets.data ?? []).filter((item) => !changed.some((one) => one.id === item.id))];
  const remember = (ticket: TicketView): void => {
    setChanged((current) => [ticket, ...current.filter((item) => item.id !== ticket.id)]);
    setOpenId(ticket.id);
    onChanged?.();
  };

  const back = onBack ? (
    <button type="button" className="link back-link" onClick={onBack}>
      <span aria-hidden="true">‹</span> {backTitle ?? t('app.back')}
    </button>
  ) : null;

  if (tickets.loading && !tickets.data) return <Skeleton count={2} />;

  if (tickets.error && !tickets.data) {
    return <Failure title={t('support.failed')} error={tickets.error} onRetry={tickets.reload} />;
  }

  if (asking) {
    return (
      <section className="list">
        <Ask
          api={api}
          onAsked={(ticket) => {
            setAsking(false);
            remember(ticket);
          }}
          onBack={() => setAsking(false)}
        />
      </section>
    );
  }

  const open = merged.find((ticket) => ticket.id === openId);

  if (open) {
    return (
      <section className="list">
        <Thread
          api={api}
          ticket={open}
          staff={staff}
          onChanged={remember}
          onBack={() => {
            setOpenId(null);
          }}
        />
      </section>
    );
  }

  const waiting = merged.filter((ticket) => ticket.status === 'open').length;

  return (
    <section className="list">
      {back}

      {contacts.data && !staff ? <Contacts contacts={contacts.data} /> : null}

      {staff ? null : (
        <Button type="button" stretched size="large" onClick={() => setAsking(true)}>
          {t('support.ask')}
        </Button>
      )}

      {merged.length === 0 ? (
        <Empty
          icon={<IconChat />}
          title={staff ? 'Вопросов нет' : t('support.empty')}
          hint={staff ? 'Здесь появятся вопросы жильцов дома' : t('support.ask.hint')}
        />
      ) : (
        <Group
          title={staff ? 'Вопросы жильцов' : t('support.yours')}
          {...(staff && waiting > 0 ? { aside: `${plural(waiting, 'ждёт', 'ждут', 'ждут')} ответа` } : {})}
        >
          {merged.map((ticket, index) => (
            <CellSimple
              key={ticket.id}
              className="ticket-row"
              before={
                <span className={ticket.status === 'open' ? 'tile tile-orange' : 'tile tile-teal'}>
                  <IconChat />
                </span>
              }
              title={ticket.subject}
              subtitle={staff ? asker(ticket) : state(t, ticket)}
              after={
                (staff ? ticket.status === 'open' : ticket.status === 'answered') ? (
                  <span className="badge badge-waiting" aria-label={t('support.waiting')}>
                    1
                  </span>
                ) : null
              }
              showChevron
              height="compact"
              separator={index > 0}
              onClick={() => setOpenId(ticket.id)}
            />
          ))}
        </Group>
      )}
    </section>
  );
};
