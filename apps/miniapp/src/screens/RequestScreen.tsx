import { Button, CellAction, CellList, CellSimple, Textarea } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import {
  ApiError,
  describeFailure,
  formatDay,
  formatDue,
  formatLeft,
  formatPublished,
  formatSince,
  plural,
  statusTitle,
  tight,
  type ComplaintOffer,
  type ComplaintSent,
  type DomovoyApi,
  type HistoryEventView,
  type RequestView,
} from '../api.js';
import { useHaptics } from '../haptics.js';
import { useToast } from '../toast.js';
import { usePhotos } from '../use-photos.js';
import { Failure } from './Failure.js';
import { ErrorText } from './ErrorText.js';
import { Attachments } from './Attachments.js';
import { Composer } from './Composer.js';
import { RequestActions } from './RequestActions.js';
import { RetryLink } from './Retry.js';
import { Clarify } from './Clarify.js';
import { Confirm } from './Confirm.js';
import { Responsibility } from './Responsibility.js';
import { Skeleton } from './Skeleton.js';
import { IconStar } from './icons.js';

export interface RequestScreenProps {
  api: DomovoyApi;
  id: string;
  staff?: boolean;
  /** Открыть обращение в инспекцию своим экраном. */
  onDocument: (title: string, text: string) => void;
  /** Заявка изменилась: список под ней перечитывается при уходе с экрана. */
  onChanged?: () => void;
  /** Вернуться к списку, из которого заявку открыли. */
  onBack?: () => void;
  /** Как называется этот список: «в очередь», «к заявкам». */
  backTitle?: string;
  /** Кто смотрит: он же берёт наряд на себя. */
  meId?: string;
  /** Как зовут смотрящего: подрядчику под этим именем обращение не передают, оно у него. */
  meName?: string;
  /** Роль сама выполняет работу: мастер и подрядчик уходят в работу без выбора. */
  selfAssigned?: boolean;
}

const CLOSED = ['confirmed', 'rejected'];

/** Что жилец делает с заявкой кнопкой: остальное сервер ему тоже разрешает, но это ход смены. */
const RESIDENT_ACTIONS = ['withdrawn'];

/** Заявка, по которой ничего больше не делается: закрытая или снятая. */
const ENDED = [...CLOSED, 'withdrawn'];

/** Категория, где причина бывает этажом выше: протечка идёт сверху. */
const LEAKS = 'plumbing';

const TONE: Record<string, string> = {
  new: 'dot-work',
  accepted: 'dot-work',
  in_progress: 'dot-work',
  needs_info: 'dot-warn',
  done: 'dot-warn',
  confirmed: 'dot-good',
  rejected: 'dot-muted',
};

const RATINGS = ['плохо', 'так себе', 'нормально', 'хорошо', 'отлично'];

/** Срок словами: до приёма считается срок ответа, дальше срок работы. */
const deadline = (request: RequestView): string => {
  if (request.status === 'rejected') return 'отклонена';
  if (request.status === 'withdrawn') return 'снята';
  if (CLOSED.includes(request.status)) return 'закрыта';
  if (request.status === 'done') {
    return request.autoConfirmAt
      ? `закроется сама через ${formatLeft(request.autoConfirmAt)}`
      : 'ждём вашей приёмки';
  }

  if (request.overdue) return `просрочено ${formatSince(request.dueAt)}`;

  return request.status === 'new' ? `ответ через ${formatLeft(request.dueAt)}` : `осталось ${formatLeft(request.dueAt)}`;
};

/** Ближайший срок числом и часом: он же стоит в полосе над ним. */
const dueLine = (request: RequestView): string | null => {
  if (ENDED.includes(request.status)) return null;

  const when = formatDue(request.status === 'new' ? request.dueAt : request.resolutionDueAt);

  if (!when) return null;

  return request.status === 'new' ? `Срок ответа: ${when}` : `Срок работ: ${when}`;
};

/** Полоса срока. У нарушенного её нет. */
const Deadline = ({ request }: { request: RequestView }) => {
  if (ENDED.includes(request.status) || request.status === 'done' || request.overdue) return null;

  const from = new Date(request.createdAt).getTime();
  const to = new Date(request.dueAt).getTime();
  const whole = to - from;

  if (!Number.isFinite(whole) || whole <= 0) return null;

  const used = Math.min(1, Math.max(0, (Date.now() - from) / whole));
  const tone = used > 0.75 ? 'bar-warn' : '';

  return (
    <div className={`bar ${tone}`.trim()} role="img" aria-label={deadline(request)}>
      <span style={{ width: `${Math.round(used * 100)}%` }} />
    </div>
  );
};

/** Что показал опрос соседей. */
const Spread = ({ view, staff }: { view: RequestView; staff?: boolean }) => {
  const spread = view.spread;

  if (!spread) return null;

  if (!staff) {
    return spread.affected > 1 ? (
      <p className="hint">Об этом сообщили {plural(spread.affected, 'сосед', 'соседа', 'соседей')}</p>
    ) : null;
  }

  const answered = spread.affected - 1 + spread.fine;

  if (answered === 0) return null;

  const shown = new Set((view.survey ?? []).map((flat) => flat.state));
  const states = (['affected', 'fine', 'silent'] as const).filter((state) => shown.has(state));

  return (
    <div className="survey-block">
      {/* Столбик квартир без подписи читается как набор цифр: рядом стоит, что он значит. */}
      <p className="hint survey-note">Соседи по стояку · {VERDICTS[spread.verdict]}</p>

      <div className="survey" aria-label="Опрос соседей">
        <div className={spread.verdict === 'shared' ? 'pipe pipe-alert' : 'pipe'}>
          <div className="flats">
            {[...(view.survey ?? [])].reverse().map((flat) => (
              <span key={flat.number} className={`flat flat-${flat.state}`} title={SURVEY_TITLES[flat.state]}>
                {flat.number}
              </span>
            ))}
          </div>
        </div>

        <p className="legend hint">
          {states.map((state) => (
            <span key={state}>
              <span className={`flat flat-${state}`} aria-hidden="true" />
              {SURVEY_TITLES[state]}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
};

/** Ответы соседей называются теми же словами, что кнопки, которыми их дают. */
const SURVEY_TITLES: Record<string, string> = {
  affected: 'И у меня',
  fine: 'Всё работает',
  silent: 'Не отвечали',
};

const VERDICTS: Record<string, string> = {
  shared: 'общее имущество',
  local: 'похоже на квартиру',
  unknown: 'ответов мало',
};

/** Точка последнего события повторяет цвет текущего состояния. */
const TIP: Record<string, string> = {
  confirmed: '#34c759',
  rejected: 'var(--faint)',
  needs_info: '#f5a623',
  done: '#f5a623',
};

/** Кто написал: своё сообщение подписывается «Вы». */
const author = (event: HistoryEventView, staff?: boolean): string => {
  if (event.speaker) return event.speaker === 'you' ? 'Вы' : 'Сосед';

  if (event.role === 'resident') return staff ? 'Жилец' : 'Вы';

  return staff ? 'Вы' : 'Управляющая компания';
};

/** Заявка, к которой срок больше не применяется: снятая или отклонённая. */
const DROPPED = ['withdrawn', 'rejected'];

const History = ({ api, request, staff }: { api: DomovoyApi; request: RequestView; staff?: boolean }) => {
  const current = request.history.findLastIndex((event) => event.kind !== 'message');

  const due = Date.parse(request.resolutionDueAt);
  const before = request.history.filter((event) => Date.parse(event.at) <= due).length;
  const settled = request.status === 'confirmed' || request.status === 'done';
  const missed = settled ? before < request.history.length : due < Date.now();

  const rows = request.history.map((event, index) => {
    const said = event.kind === 'message';
    const label = said ? author(event, staff) : statusTitle(event.status, staff);
    const mine = event.speaker ? event.speaker === 'you' : (event.role === 'resident') !== Boolean(staff);
    const attachments = event.attachments ?? [];
    const talk =
      event.comment || attachments.length > 0 ? (
        <div className={mine ? 'bubble-row bubble-row-mine' : 'bubble-row'}>
          <div className={mine ? 'bubble bubble-mine' : 'bubble'}>
            {said && !mine ? <span className="bubble-author">{label}</span> : null}
            {event.comment ? <p className="description">{event.comment}</p> : null}
            <Attachments api={api} items={attachments} alt={label} />
            {said ? <time className="said-at">{formatPublished(event.at)}</time> : null}
          </div>
        </div>
      ) : null;

    if (said) {
      return (
        <li key={`${event.at}-${index}`} className="said">
          {talk}
        </li>
      );
    }

    return (
      <li key={`${event.at}-${index}`} className={index === current ? 'now' : undefined}>
        <span className="status">{label}</span> <time>{formatPublished(event.at)}</time>

        {event.onSite ? <span className="on-site">на месте</span> : null}
        {talk}
      </li>
    );
  });

  if (!DROPPED.includes(request.status)) {
    rows.splice(
      before,
      0,
      <li key="due" className={missed ? 'due-mark due-missed' : 'due-mark'}>
        <span className="status">{missed ? 'Просрочено' : 'Срок'}</span>{' '}
        <time>{formatPublished(request.resolutionDueAt)}</time>
      </li>,
    );
  }

  return (
    <ol className="timeline" style={{ ['--timeline-tip' as string]: TIP[request.status] ?? 'var(--accent)' }}>
      {rows}
    </ol>
  );
};

/** Заявка соседа по общему имуществу: её можно подтвердить. */
const Support = ({ api, request, onChanged }: { api: DomovoyApi; request: RequestView; onChanged: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const haptics = useHaptics();
  const say = useToast();

  const support = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await api.supportRequest(request.id);
      haptics.done();
      say('Записал: у вас то же самое');
      onChanged();
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CellList mode="island">
        <CellSimple
          className="row-split"
          title="У вас то же самое?"
          height="compact"
        />

        <CellAction className="row-split" mode="primary" disabled={busy} onClick={() => void support()}>
          {busy ? 'Отправляем…' : 'И у меня'}
        </CellAction>
      </CellList>

      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
};

/**
 * Стук к соседу сверху: вопрос уходит от бота, без имён и номеров квартир.
 * Предлагается только по протечке: в других поломках сосед сверху ни при чём.
 */
const Knock = ({ api, request, onChanged }: { api: DomovoyApi; request: RequestView; onChanged: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const haptics = useHaptics();
  const say = useToast();

  if (request.category !== LEAKS) return null;

  if (request.knocked) return <p className="hint">Соседу сверху сообщили</p>;

  if (!request.canKnock) return null;

  const knock = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await api.knockUpstairs(request.id);
      haptics.done();
      say('Соседу сверху сообщили');
      onChanged();
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : 'Не получилось сообщить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CellList mode="island">
        <CellSimple
          className="row-split"
          title="Течёт сверху?"
          subtitle="Домовой спросит соседа, не у него ли, без вашего имени и номера квартиры"
          height="compact"
        />

        <CellAction className="row-split" mode="secondary" disabled={busy} onClick={() => void knock()}>
          {busy ? 'Отправляем…' : 'Сообщить соседу сверху'}
        </CellAction>
      </CellList>

      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
};

/** Разговор по заявке. */
const Talk = ({
  api,
  request,
  staff,
  onChanged,
}: {
  api: DomovoyApi;
  request: RequestView;
  staff?: boolean;
  onChanged: () => void;
}) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photos = usePhotos(api);
  const haptics = useHaptics();

  const answering = !staff && request.status === 'needs_info';
  const shared = !staff && !answering && request.reporters > 1;

  const send = async (): Promise<void> => {
    const message = text.trim();

    if (message.length === 0 && photos.photos.length === 0) return;

    setBusy(true);
    setError(null);

    try {
      if (answering) {
        await api.transition(request.id, 'in_progress', {
          comment: message,
          ...(photos.photos.length > 0 ? { attachments: photos.photos } : {}),
        });
      } else {
        await api.comment(request.id, message, photos.photos);
      }

      haptics.done();
      setText('');
      photos.reset();
      onChanged();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Сообщение не отправлено');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="talk">
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Composer
        api={api}
        id={`request-say-${request.id}`}
        label={answering ? 'Ответ на уточнение' : 'Сообщение по заявке'}
        placeholder={answering ? 'Ваш ответ' : shared ? 'Соседям и в УК' : 'Сообщение'}
        value={text}
        busy={busy}
        photos={photos}
        onChange={setText}
        onSend={() => void send()}
      />
    </div>
  );
};

/** Приёмка работы: заявку закрывает жилец. */
const Acceptance = ({ api, request, onChanged }: { api: DomovoyApi; request: RequestView; onChanged: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [returning, setReturning] = useState(false);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const haptics = useHaptics();
  const say = useToast();

  const decide = async (accepted: boolean): Promise<void> => {
    if (!accepted && comment.trim().length === 0) {
      setReturning(true);
      return;
    }

    setBusy(true);
    setFailed(undefined);

    try {
      await api.transition(request.id, accepted ? 'confirmed' : 'in_progress', {
        ...(accepted ? {} : { comment: comment.trim() }),
        ...(accepted && rating ? { rating } : {}),
      });
      haptics.done();
      say(accepted ? 'Работа принята, заявка закрыта' : 'Заявка вернулась в работу');
      onChanged();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(false);
    }
  };

  if (returning) {
    return (
      <section className="block">
        <h2>Что не сделано?</h2>
        <Textarea
          mode="secondary"
          rows={3}
          value={comment}
          placeholder="Опишите, что осталось"
          onChange={(event) => setComment(event.target.value)}
        />
        <div className="actions">
          <Button
            type="button"
            stretched
            size="large"
            disabled={busy || comment.trim().length === 0}
            onClick={() => void decide(false)}
          >
            Вернуть в работу
          </Button>
          <button type="button" className="link" onClick={() => setReturning(false)}>
            Отмена
          </button>
        </div>

        {failed ? <ErrorText>{failed}</ErrorText> : null}
      </section>
    );
  }

  return (
    <>
      <section className="block">
        <h2>Работа сделана?</h2>

        <div className="rating" role="group" aria-label="Оценка работы">
          <span className="stars">
            {RATINGS.map((title, index) => (
              <button
                key={title}
                type="button"
                className={rating !== null && index + 1 <= rating ? 'star star-on' : 'star'}
                aria-label={`${index + 1} из 5, ${title}`}
                aria-pressed={rating === index + 1}
                disabled={busy}
                onClick={() => {
                  haptics.picked();
                  setRating(index + 1);
                }}
              >
                <IconStar filled={rating !== null && index + 1 <= rating} />
              </button>
            ))}
          </span>

          <span className="rating-word">{rating === null ? '' : RATINGS[rating - 1]}</span>
        </div>

        <div className="actions">
          <Button type="button" stretched size="large" disabled={busy} onClick={() => void decide(true)}>
            Принять работу
          </Button>
        </div>

        {failed ? <ErrorText>{failed}</ErrorText> : null}
      </section>

      <CellList className="actions-more" mode="island">
        <CellAction mode="secondary" disabled={busy} onClick={() => setReturning(true)}>
          Вернуть в работу
        </CellAction>
      </CellList>
    </>
  );
};

/**
 * Проверенные основания жалоб по заявкам. Экран заявки уходит, пока человек
 * читает текст жалобы, и по возвращении основание и отметка об отправке
 * должны быть на месте, а не запрашиваться заново.
 */
const OFFERS = new Map<string, ComplaintOffer>();

/** Обращение в жилищную инспекцию. */
const Complaint = ({
  api,
  request,
  onDocument,
}: {
  api: DomovoyApi;
  request: RequestView;
  onDocument: (title: string, text: string) => void;
}) => {
  const [offer, setOffer] = useState<ComplaintOffer | null>(OFFERS.get(request.id) ?? null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const say = useToast();

  const keep = (next: ComplaintOffer): void => {
    OFFERS.set(request.id, next);
    setOffer(next);
  };

  const check = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);

    try {
      keep(await api.complaint(request.id));
    } catch (error) {
      // Отказ проверки кнопку не убирает: попробовать ещё раз есть чем.
      setFailed(error instanceof ApiError ? error.message : 'Не удалось проверить сроки');
    } finally {
      setBusy(false);
    }
  };

  /** Письмо в орган власти уходит только после согласия человека. */
  const send = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);

    try {
      const receipt: ComplaintSent = await api.sendComplaint(request.id);

      keep({ ...(offer ?? { possible: true, reason: '' }), sent: receipt });
      setAsking(false);
      say('Обращение отправлено');
    } catch (error) {
      setFailed(error instanceof ApiError ? error.message : 'Обращение не ушло');
    } finally {
      setBusy(false);
    }
  };

  if (!request.overdue) return null;

  const done = offer?.sent;

  return (
    <div className="complaint">
      {offer ? null : (
        <button type="button" className="link quiet" disabled={busy} onClick={() => void check()}>
          {busy ? 'Проверяем сроки…' : 'Пожаловаться в жилинспекцию'}
        </button>
      )}

      {done ? (
        <p className="hint">
          Отправлено: {done.organization}
          {done.externalId ? `, обращение ${done.externalId}` : ''}. Ответ до {formatDay(done.dueAt)}.
        </p>
      ) : null}

      {offer && !done ? (
        <p className="hint">{offer.possible ? `Основание: ${offer.reason}` : `Жалобу пока не отправить: ${offer.reason}`}</p>
      ) : null}

      {/* Отправку человек видит там же, где узнал об основании: текст открывается
          отдельно и только если он хочет его прочитать. */}
      {offer?.possible && !done ? (
        <div className="actions">
          <Button type="button" stretched size="large" disabled={busy} onClick={() => setAsking(true)}>
            Отправить жалобу
          </Button>

          {offer.complaint ? (
            <button
              type="button"
              className="link"
              onClick={() => onDocument('Жалоба в жилинспекцию', offer.complaint ?? '')}
            >
              Прочитать жалобу
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Текст обращения остаётся доступным и после отправки: его иногда просят приложить. */}
      {done && offer.complaint ? (
        <button
          type="button"
          className="link"
          onClick={() => onDocument('Жалоба в жилинспекцию', offer.complaint ?? '')}
        >
          Прочитать жалобу
        </button>
      ) : null}

      {asking ? (
        <Confirm
          title="Отправить жалобу?"
          text="Уйдёт в жилинспекцию от вашего имени. Ответ в течение 30 дней."
          confirmLabel="Отправить"
          busyLabel="Отправляем…"
          busy={busy}
          onConfirm={() => void send()}
          onCancel={() => setAsking(false)}
        />
      ) : null}

      {failed ? <ErrorText>{failed}</ErrorText> : null}
    </div>
  );
};

/** Заявка целиком: что случилось, что с ней происходит и что можно сделать. */
/** Телефон жильца, если он им поделился: ссылка сразу набирает номер. */
const Contact = ({ api, id }: { api: DomovoyApi; id: string }) => {
  const contact = useBridgeRequest((alive) => api.until(alive).requestContact(id).catch(() => null), [api, id]);
  const phone = contact.data?.phone;

  if (!phone) return null;

  return (
    <p className="hint">
      {contact.data?.displayName}: <a href={`tel:${phone}`}>{phone}</a>
    </p>
  );
};

export const RequestScreen = ({
  api,
  id,
  staff,
  onDocument,
  onChanged,
  onBack,
  backTitle,
  meId,
  meName,
  selfAssigned,
}: RequestScreenProps) => {
  const request = useBridgeRequest((alive) => api.until(alive).getRequest(id), [api, id]);
  // Список сотрудников нужен тому, кто выбирает исполнителя: мастер и подрядчик берут наряд на себя.
  const picks = Boolean(staff) && !selfAssigned;
  const people = useBridgeRequest(async (alive) => (picks ? api.until(alive).staff() : []), [api, picks]);

  const reload = (): void => {
    request.reload();
    onChanged?.();
  };

  if (request.loading && !request.data) return <Skeleton count={1} />;

  if (request.error || !request.data) {
    return <Failure title="Заявка не загрузилась" error={request.error} onRetry={request.reload} />;
  }

  const view = request.data;
  const mine = !staff && view.mine !== false;
  const watching = !staff && view.mine === false;
  const ended = ENDED.includes(view.status);
  const due = dueLine(view);

  return (
    <div className="list">
      {onBack ? (
        <button type="button" className="link back-link" onClick={onBack}>
          <span aria-hidden="true">‹</span> {backTitle ?? 'Назад'}
        </button>
      ) : null}

      <section className="block">

        <p className="request-head">
          <span className="row-state">
            <span className={`dot ${view.overdue ? 'dot-bad' : (TONE[view.status] ?? 'dot-work')}`} />
            {view.statusTitle ?? statusTitle(view.status, staff)}
          </span>
          <span className="number">{view.number}</span>
        </p>

        <p className="request-title">{view.title}</p>

        <p className="hint">
          {tight(view.target)} · <span className={view.overdue ? 'overdue' : undefined}>{deadline(view)}</span>
        </p>

        <Deadline request={view} />

        {due ? <p className="hint aside">{due}</p> : null}

        {view.description === view.title ? null : <p className="description">{view.description}</p>}

        <Attachments api={api} items={view.attachments} alt={`Фото к заявке ${view.number}`} />

        {view.hint ? <p className="row-state request-hint">{view.hint}</p> : null}

        {view.assigneeName ? <p className="hint">Работу ведёт {view.assigneeName}</p> : null}

        {/* Памятка исполнителю, а не жильцу: с чем его пускают в квартиру. */}
        {view.workerNote ? <p className="hint aside">{view.workerNote}</p> : null}

        <Spread view={view} staff={staff} />
        {staff ? <Contact api={api} id={view.id} /> : null}
        {view.rating ? <p className="hint">Оценка жильца: {view.rating} из 5</p> : null}
      </section>

      {/* Сотрудники не дошли: без этой строки назначение выглядит так, будто
          в компании никого нет. */}
      {picks && (people.data ?? []).length === 0 && people.error ? (
        <RetryLink title="Список сотрудников не загрузился" onRetry={people.reload} />
      ) : null}

      {staff ? (
        <RequestActions
          api={api}
          request={view}
          staff={people.data ?? []}
          {...(meId ? { meId } : {})}
          {...(selfAssigned ? { selfAssigned } : {})}
          onChanged={reload}
        />
      ) : null}

      {/* Уточнение адреса видит автор заявки, кем бы он ни был: продукт
          спрашивает только его, остальным приходит пустой ответ. */}
      {ended ? null : <Clarify api={api} requestId={view.id} onChanged={reload} />}

      <Responsibility
        api={api}
        requestId={view.id}
        staff={staff}
        closed={ended}
        {...(selfAssigned && meName ? { own: meName } : {})}
        onChanged={reload}
      />

      {watching && !ended ? <Support api={api} request={view} onChanged={reload} /> : null}

      {ended || watching ? null : <Knock api={api} request={view} onChanged={reload} />}

      {mine && view.status === 'done' ? <Acceptance api={api} request={view} onChanged={reload} /> : null}

      <section className="block">
        <h2>История</h2>
        <History api={api} request={view} staff={staff} />

        {ended || watching ? null : <Talk api={api} request={view} staff={staff} onChanged={reload} />}
      </section>

      {/* Жильцу из действий остаётся только отзыв: на уточнение он отвечает сообщением выше. */}
      {mine && view.status !== 'done' ? (
        <RequestActions api={api} request={view} staff={[]} only={RESIDENT_ACTIONS} onChanged={reload} />
      ) : null}

      {mine ? <Complaint api={api} request={view} onDocument={onDocument} /> : null}
    </div>
  );
};
