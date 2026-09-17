import { Button, Input, Textarea } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import {
  ApiError,
  needsApartment,
  type DomovoyApi,
  type InitiativeView,
  type PollView,
  type VoteChoiceView,
} from '../api.js';
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

      <p className="description">{poll.question}</p>

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

      {poll.open ? (
        <div className="segments" role="group" aria-label="Ваш голос">
          {CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={poll.myChoice === choice.value ? 'segment segment-on' : 'segment'}
              aria-pressed={poll.myChoice === choice.value}
              disabled={busy}
              onClick={() => void cast(choice.value)}
            >
              {choice.title}
            </button>
          ))}
        </div>
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
            <option value="qualified">Квалифицированное, две трети</option>
          </select>

          <label htmlFor={`meeting-days-${initiative.id}`}>Сколько дней идёт голосование</label>
          <Input
            className="field"
            id={`meeting-days-${initiative.id}`}
            type="number"
            min={1}
            max={90}
            value={days}
            withClearButton={false}
            onChange={(event) => setDays(event.target.value)}
          />

          <Button
            type="button"
            stretched
            disabled={busy}
            onClick={() => void run(() => api.callMeeting(initiative.id, Number(days), kind), 'Собрание не объявлено')}
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (): Promise<void> => {
    if (title.trim().length === 0 || question.trim().length === 0) {
      setError('Заполните тему и вопрос');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await api.startPoll({ kind, title: title.trim(), question: question.trim(), days: Number(days) });
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
        type="number"
        min={1}
        max={90}
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
  const polls = useBridgeRequest(() => api.polls(), [api]);
  const initiatives = useBridgeRequest(() => api.initiatives(), [api]);

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
