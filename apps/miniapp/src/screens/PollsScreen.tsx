import { Button, Input, Textarea } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import {
  ApiError,
  formatDay,
  needsApartment,
  parseCount,
  type DomovoyApi,
  type InitiativeView,
  type PollView,
  type VoteChoiceView,
} from '../api.js';
import { Confirm } from './Confirm.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { IconPolls } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface PollsScreenProps {
  api: DomovoyApi;
  /** Сотрудник может объявить собрание. */
  canStart?: boolean;
  /** Открыть протокол своим экраном. */
  onDocument: (title: string, text: string) => void;
  /** Куда идти, если квартира ещё не привязана: голос весит её метры. */
  onBind?: () => void;
}

const CHOICES: { value: VoteChoiceView; title: string }[] = [
  { value: 'for', title: 'За' },
  { value: 'against', title: 'Против' },
  { value: 'abstain', title: 'Воздержусь' },
];

/** Голос словами: он же стоит в подтверждении замены. */
const choiceTitle = (choice?: VoteChoiceView): string =>
  CHOICES.find((item) => item.value === choice)?.title.toLowerCase() ?? 'не подан';

/** Доля в процентах. Прочерк вместо «NaN%», если сервер долю не прислал. */
const percent = (share: number): string => (Number.isFinite(share) ? `${Math.round(share * 100)}%` : '0%');

/** Площадь для человека: один знак после запятой, без хвоста из нулей. */
const area = (value: number): string => String(Math.round(value * 10) / 10);

/** Доли считаются от площади дома. */
const PollCard = ({
  api,
  poll,
  onVoted,
  onDocument,
}: {
  api: DomovoyApi;
  poll: PollView;
  onVoted: () => void;
  onDocument: (title: string, text: string) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<VoteChoiceView | null>(null);

  const showProtocol = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      onDocument(`Протокол: ${poll.title}`, await api.pollProtocol(poll.id));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Протокол недоступен');
    } finally {
      setBusy(false);
    }
  };

  const cast = async (choice: VoteChoiceView): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await api.vote(poll.id, choice);
      onVoted();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Голос не принят');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="request poll">
      <header>
        <strong className="poll-title">{poll.title}</strong>
        <span className="row-state">
          <span className={poll.open || !poll.closedAt ? 'dot' : poll.passed ? 'dot dot-good' : 'dot dot-muted'} />

          {poll.open ? 'идёт' : !poll.closedAt ? 'считаем' : poll.passed ? 'принято' : 'не принято'}
        </span>
      </header>

      {/* Опрос и собрание решают разное: это видно сразу, а не в протоколе. */}
      {poll.mode === 'survey' ? <p className="hint">Опрос: мнение, не решение</p> : null}

      {/* Силу заочному голосованию даёт государственная система: номер оттуда
          стоит рядом, чтобы человек мог найти собрание и там. */}
      {poll.noticeId ? <p className="hint aside">Собрание в системе: {poll.noticeId}</p> : null}
      {poll.protocolId ? <p className="hint aside">Протокол в системе: {poll.protocolId}</p> : null}

      {poll.mode !== 'survey' && !poll.open && !poll.closedAt && new Date(poll.opensAt) > new Date() ? (
        <p className="hint">Голосование откроется {formatDay(poll.opensAt)}</p>
      ) : null}

      <p className="description">{poll.question}</p>

      {/* У опроса нет ни кворума, ни порога решения: считаются только голоса. */}
      {poll.mode === 'survey' ? (
        <div className="quorum">
          <div
            className="quorum-bar"
            role="progressbar"
            aria-label="Участие в опросе"
            aria-valuenow={Math.round(poll.turnout * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="quorum-fill" style={{ width: percent(Math.min(1, poll.turnout)) }} />
          </div>

          <p className="quorum-meta">
            Ответили {percent(poll.turnout)} площади · за {percent(poll.shares.for)}, против{' '}
            {percent(poll.shares.against)}
          </p>
        </div>
      ) : (
        <div className="quorum">
          <div
            className="quorum-bar"
            role="progressbar"
            aria-label="Участие в собрании"
            aria-valuenow={Math.round(poll.turnout * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className={poll.quorum ? 'quorum-fill quorum-fill-ok' : 'quorum-fill'} style={{ width: percent(Math.min(1, poll.turnout)) }} />

            {poll.quorumShare === undefined ? null : (
              <span className="quorum-mark" style={{ left: percent(poll.quorumShare) }}>
                <span className="quorum-mark-label">кворум</span>
              </span>
            )}
          </div>

          <p className="quorum-meta">
            {poll.quorum ? (
              <strong className="quorum-ok">Кворум есть</strong>
            ) : (
              <>Не хватает {area(poll.areaToQuorum)} м² до кворума</>
            )}
            {' · за '}
            {percent(poll.shares.for)} площади, против {percent(poll.shares.against)}
          </p>

          {/* Порог задан законом, а не продуктом: основание стоит рядом с полосой. */}
          {poll.basis ? <p className="hint aside">{poll.basis}</p> : null}
        </div>
      )}

      {poll.open ? (
        <>
          {/* В квартире живёт не один человек, а голос у неё один: заменять
              чужой голос молча нельзя. */}
          {poll.votedBy ? (
            <p className="hint">
              Голос квартиры подал {poll.votedBy}: {choiceTitle(poll.myChoice)}. Ваш голос заменит его.
            </p>
          ) : null}

          <div className="segments" role="group" aria-label="Ваш голос">
            {CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={poll.myChoice === choice.value ? 'segment segment-on' : 'segment'}
                aria-pressed={poll.myChoice === choice.value}
                disabled={busy}
                onClick={() => (poll.votedBy ? setReplacing(choice.value) : void cast(choice.value))}
              >
                {choice.title}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {replacing ? (
        <Confirm
          title="Заменить голос квартиры?"
          text={`Сейчас записан голос: ${choiceTitle(poll.myChoice)}, его подал ${poll.votedBy}. У квартиры один голос, считается последний.`}
          confirmLabel={`Голосовать «${choiceTitle(replacing)}»`}
          busy={busy}
          busyLabel="Записываем…"
          onConfirm={() => {
            const choice = replacing;

            setReplacing(null);
            void cast(choice);
          }}
          onCancel={() => setReplacing(null)}
        />
      ) : null}

      {poll.closedAt ? (
        <button type="button" className="link" disabled={busy} onClick={() => void showProtocol()}>
          {busy ? 'Открываем…' : 'Протокол'}
        </button>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}
    </article>
  );
};

/**
 * Предложение жильца: подписи весят площадью так же, как голоса на собрании.
 * Собранная десятина площади даёт право требовать созыва собрания.
 */
const InitiativeCard = ({
  api,
  initiative,
  canStart,
  onChanged,
}: {
  api: DomovoyApi;
  initiative: InitiativeView;
  canStart?: boolean;
  onChanged: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [calling, setCalling] = useState(false);
  const [kind, setKind] = useState<'simple' | 'qualified'>(initiative.kind);
  const [days, setDays] = useState('14');
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, failure: string): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await action();
      onChanged();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const target = initiative.demandShare ?? 0.1;

  return (
    <article className="request poll">
      <header>
        <strong className="poll-title">{initiative.title}</strong>
        <span className="row-state">
          <span className={initiative.enough ? 'dot dot-good' : 'dot'} />
          {initiative.enough ? 'подписей хватает' : 'собираем подписи'}
        </span>
      </header>

      <p className="description">{initiative.question}</p>

      <div className="quorum">
        <div
          className="quorum-bar"
          role="progressbar"
          aria-label="Подписи соседей"
          aria-valuenow={Math.round((initiative.share / target) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >

          <span
            className={initiative.enough ? 'quorum-fill quorum-fill-ok' : 'quorum-fill'}
            style={{ width: percent(Math.min(1, initiative.share / target)) }}
          />
        </div>
        <p className="quorum-meta">
          {initiative.enough ? (
            <strong className="quorum-ok">Дом вправе требовать собрания</strong>
          ) : (
            <>Не хватает {area(initiative.areaToDemand ?? 0)} м²</>
          )}
          {' · подписей '}
          {initiative.signatures}
        </p>

        {initiative.basis ? <p className="hint aside">{initiative.basis}</p> : null}
      </div>

      {initiative.mine || canStart ? null : (
        <Button
          type="button"
          stretched
          disabled={busy}
          onClick={() => void run(() => api.supportInitiative(initiative.id), 'Подпись не принята')}
        >
          Поддержать
        </Button>
      )}

      {canStart && !calling ? (
        <button type="button" className="link" onClick={() => setCalling(true)}>
          Созвать собрание
        </button>
      ) : null}

      {canStart && calling ? (
        <>
          <label htmlFor={`meeting-kind-${initiative.id}`}>Какое большинство решает</label>
          <select
            id={`meeting-kind-${initiative.id}`}
            value={kind}
            onChange={(event) => setKind(event.target.value as never)}
          >
            <option value="simple">Простое большинство</option>
            <option value="qualified">Две трети голосов</option>
          </select>

          <label htmlFor={`meeting-days-${initiative.id}`}>Сколько дней идёт голосование</label>
          <Input
            className="field"
            id={`meeting-days-${initiative.id}`}
            inputMode="numeric"
            value={days}
            withClearButton={false}
            onChange={(event) => setDays(event.target.value)}
          />

          <Button
            type="button"
            stretched
            disabled={busy}
            onClick={() => {
              const asked = parseCount(days, 1, 90);

              // Пустое поле раньше уходило нулём дней: голосование закрывалось сразу.
              if (asked === null) {
                setError('Срок от 1 до 90 дней');
                return;
              }

              void run(() => api.callMeeting(initiative.id, asked, kind), 'Собрание не объявлено');
            }}
          >
            {busy ? 'Объявляем…' : 'Объявить'}
          </Button>
          <button type="button" className="link" onClick={() => setCalling(false)}>
            Отмена
          </button>
        </>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}
    </article>
  );
};

/** Предложение соседям: собрание объявляет управляющая компания, вопрос ставит дом. */
const InitiativeComposer = ({ api, onStarted }: { api: DomovoyApi; onStarted: () => void }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (): Promise<void> => {
    if (title.trim().length === 0 || question.trim().length === 0) {
      setError('Заполните тему и предложение');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await api.startInitiative({ title: title.trim(), question: question.trim() });
      setTitle('');
      setQuestion('');
      setOpen(false);
      onStarted();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось завести предложение');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button type="button" className="publish" size="large" stretched onClick={() => setOpen(true)}>
        Предложить соседям
      </Button>
    );
  }

  return (
    <section className="card">
      <h2>Предложение соседям</h2>

      <label htmlFor="initiative-title">Тема</label>
      <Input
        className="field"
        id="initiative-title"
        value={title}
        maxLength={200}
        withClearButton={false}
        onChange={(event) => setTitle(event.target.value)}
      />

      <label htmlFor="initiative-question">Что предлагаете</label>
      <Textarea
        mode="secondary"
        id="initiative-question"
        rows={3}
        maxLength={2000}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
      />

      {error ? <ErrorText>{error}</ErrorText> : null}

      <Button type="button" stretched disabled={busy} onClick={() => void start()}>
        {busy ? 'Отправляем…' : 'Предложить'}
      </Button>
      <button type="button" className="link" onClick={() => setOpen(false)}>
        Отмена
      </button>
    </section>
  );
};

/** Объявление собрания: доступно только управляющей компании. */
const PollComposer = ({ api, onStarted }: { api: DomovoyApi; onStarted: () => void }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [kind, setKind] = useState<'simple' | 'qualified'>('simple');
  const [days, setDays] = useState('14');
  const [mode, setMode] = useState<'meeting' | 'survey'>('meeting');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (): Promise<void> => {
    if (title.trim().length === 0 || question.trim().length === 0) {
      setError('Заполните тему и вопрос');
      return;
    }

    const least = mode === 'meeting' ? 7 : 1;
    const asked = parseCount(days, least, 60);

    // Пустое поле раньше уходило нулём дней: голосование закрывалось сразу.
    if (asked === null) {
      setError(`Срок от ${least} до 60 дней`);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await api.startPoll({ kind, title: title.trim(), question: question.trim(), days: asked, mode });
      setTitle('');
      setQuestion('');
      setOpen(false);
      onStarted();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось объявить собрание');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button type="button" className="publish" size="large" stretched onClick={() => setOpen(true)}>
        Объявить собрание
      </Button>
    );
  }

  return (
    <section className="card">
      <h2>Новое собрание</h2>

      <label htmlFor="poll-mode">Что объявляем</label>
      <select id="poll-mode" value={mode} onChange={(event) => setMode(event.target.value as never)}>
        <option value="meeting">Собрание собственников</option>
        <option value="survey">Опрос жильцов</option>
      </select>

      {/* Решение принимает собрание, а опрос только показывает мнение: разница
          видна до объявления, а не после. */}
      <p className="hint">
        {mode === 'meeting'
          ? 'Начнётся через 10 дней, идёт от 7 до 60 дней.'
          : 'Начнётся сразу. Решения не принимает.'}
      </p>

      <label htmlFor="poll-title">Тема</label>
      <Input
        className="field"
        id="poll-title"
        value={title}
        maxLength={200}
        withClearButton={false}
        onChange={(event) => setTitle(event.target.value)}
      />

      <label htmlFor="poll-question">Вопрос на голосование</label>
      <Textarea
          mode="secondary"
        id="poll-question"
        rows={3}
        maxLength={2000}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
      />

      <label htmlFor="poll-kind">Какое большинство решает</label>
      <select id="poll-kind" value={kind} onChange={(event) => setKind(event.target.value as never)}>
        <option value="simple">Простое большинство</option>
        <option value="qualified">Квалифицированное, две трети</option>
      </select>

      <p className="hint">
        {kind === 'simple' ? 'Считаем от участников собрания' : 'Считаем от всех собственников дома'}
      </p>

      <label htmlFor="poll-days">Сколько дней идёт голосование</label>
      <Input
        className="field"
        id="poll-days"
        inputMode="numeric"
        value={days}
        withClearButton={false}
        onChange={(event) => setDays(event.target.value)}
      />

      {error ? <ErrorText>{error}</ErrorText> : null}

      <Button type="button" stretched disabled={busy} onClick={() => void start()}>
        {busy ? 'Объявляем…' : 'Объявить'}
      </Button>
      <button type="button" className="link" onClick={() => setOpen(false)}>
        Отмена
      </button>
    </section>
  );
};

/** Собрания собственников. */
export const PollsScreen = ({ api, canStart, onDocument, onBind }: PollsScreenProps) => {
  const polls = useBridgeRequest((alive) => api.until(alive).polls(), [api]);
  const initiatives = useBridgeRequest((alive) => api.until(alive).initiatives(), [api]);

  if (polls.loading && !polls.data) return <Skeleton count={1} />;

  if (polls.error) {
    return (
      <Failure title="Собрания недоступны" error={polls.error} onRetry={polls.reload}>
        {onBind && needsApartment(polls.error) ? (
          <Button type="button" onClick={onBind}>
            Привязать квартиру
          </Button>
        ) : null}
      </Failure>
    );
  }

  const collecting = (initiatives.data ?? []).filter((initiative) => !initiative.pollId);

  const reload = (): void => {
    polls.reload();
    initiatives.reload();
  };

  return (
    <section className="list">
      {canStart ? <PollComposer api={api} onStarted={reload} /> : <InitiativeComposer api={api} onStarted={reload} />}

      {collecting.map((initiative) => (
        <InitiativeCard
          key={initiative.id}
          api={api}
          initiative={initiative}
          canStart={canStart}
          onChanged={reload}
        />
      ))}

      {polls.data?.length === 0 && collecting.length === 0 ? (
        <Empty
          icon={<IconPolls />}
          title="Собраний нет"
          hint="Здесь будут голосования собственников"
        />
      ) : null}

      {polls.data?.map((poll) => <PollCard key={poll.id} api={api} poll={poll} onVoted={polls.reload} onDocument={onDocument} />)}
    </section>
  );
};
