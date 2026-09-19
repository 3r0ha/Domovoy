import { Button, CellAction, CellInput, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import {
  describeFailure,
  type DomovoyApi,
  type ReceptionView,
  type ReceptionWindowView,
  type VisitView,
} from '../api.js';
import { useHaptics } from '../haptics.js';
import { useToast } from '../toast.js';
import { Confirm } from './Confirm.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconCalendar, IconPerson } from './icons.js';
import { RetryLink } from './Retry.js';
import { Skeleton } from './Skeleton.js';

export interface VisitsScreenProps {
  api: DomovoyApi;
  /** Смена видит записи дома, жилец записывается сам. */
  staff?: boolean;
  /** Уйти в поддержку: приём ведут не все организации, а вопрос есть всегда. */
  onSupport?: () => void;
  /** Часы приёма задаёт управляющий. */
  canSchedule?: boolean;
}

/** Кто записан: имя и квартира. */
const who = (visit: VisitView): string =>
  [visit.residentName ?? 'Жилец', visit.apartment === undefined ? '' : `кв. ${visit.apartment}`]
    .filter(Boolean)
    .join(', ');

/** Дни недели в узком столбце: полное название в него не помещается. */
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const NEW_WINDOW: ReceptionWindowView = { weekday: 2, from: '15:00', to: '19:00' };

/** Приёмные часы дома: их задаёт управляющий. */
const Hours = ({
  api,
  hours,
  known,
  onSaved,
}: {
  api: DomovoyApi;
  hours?: string;
  /** Заданные окна: их правят, а не набирают заново. */
  known?: ReceptionWindowView[];
  onSaved: (view: ReceptionView) => void;
}) => {
  const [windows, setWindows] = useState<ReceptionWindowView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const save = async (): Promise<void> => {
    if (!windows) return;

    // Окно, которое кончается раньше, чем начинается, не оставляет ни одного
    // времени для записи: жилец видит день приёма и не может в него попасть.
    const wrong = windows.findIndex((window) => window.from >= window.to);

    if (wrong >= 0) {
      setError(`Окно ${wrong + 1}: время «до» должно быть позже времени «с»`);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      onSaved(await api.setReception(windows));
      setWindows(null);
      toast('Часы приёма сохранены');
    } catch (reason) {
      setError(describeFailure(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!windows) {
    return (
      <Group title="Часы приёма">
        <CellSimple
          before={
            <span className="tile tile-green">
              <IconCalendar />
            </span>
          }
          title={hours || 'Часы приёма не заданы'}
          subtitle="Из них жильцы и выбирают время"
          height="compact"
        />
        <CellAction
          mode="secondary"
          onClick={() => setWindows(known?.length ? known.map((window) => ({ ...window })) : [{ ...NEW_WINDOW }])}
        >
          {hours ? 'Изменить часы' : 'Задать часы'}
        </CellAction>
      </Group>
    );
  }

  return (
    <Group title="Часы приёма">
      <div className="rows-box">
        <p className="hint rows-about">Заданные окна заменят прежние</p>

        <div className="rows">
          {windows.map((window, index) => (
            <div key={index} className="rows-line">
              <select
                className="rows-cell rows-wide"
                aria-label={`День недели, окно ${index + 1}`}
                value={window.weekday}
                onChange={(event) =>
                  setWindows(
                    windows.map((current, at) =>
                      at === index ? { ...current, weekday: Number(event.target.value) } : current,
                    ),
                  )
                }
              >
                {WEEKDAYS.map((title, day) => (
                  <option key={title} value={day + 1}>
                    {title}
                  </option>
                ))}
              </select>

              <input
                className="rows-cell rows-time"
                type="time"
                aria-label={`С, окно ${index + 1}`}
                value={window.from}
                onChange={(event) =>
                  setWindows(
                    windows.map((current, at) => (at === index ? { ...current, from: event.target.value } : current)),
                  )
                }
              />

              <input
                className="rows-cell rows-time"
                type="time"
                aria-label={`До, окно ${index + 1}`}
                value={window.to}
                onChange={(event) =>
                  setWindows(
                    windows.map((current, at) => (at === index ? { ...current, to: event.target.value } : current)),
                  )
                }
              />

              <button
                type="button"
                className="rows-drop"
                aria-label={`Убрать окно ${index + 1}`}
                onClick={() => setWindows(windows.filter((_current, at) => at !== index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="row-links">
          <button type="button" className="link" onClick={() => setWindows([...windows, { ...NEW_WINDOW }])}>
            Добавить окно
          </button>

          <button type="button" className="link quiet" onClick={() => setWindows(null)}>
            Отмена
          </button>
        </div>

        {error ? <ErrorText>{error}</ErrorText> : null}
      </div>

      <CellAction mode="primary" disabled={busy || windows.length === 0} onClick={() => void save()}>
        {busy ? 'Сохраняем…' : 'Сохранить часы'}
      </CellAction>
    </Group>
  );
};

/** Пришедший без записи: сотрудник заносит его сам. */
const WalkIn = ({ api, onRecorded }: { api: DomovoyApi; onRecorded: () => void }) => {
  const people = useBridgeRequest((alive) => api.until(alive).people(), [api]);
  const [open, setOpen] = useState(false);
  const [residentId, setResidentId] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const residents = (Array.isArray(people.data) ? people.data : []).filter((person) => person.role === 'resident');

  const record = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await api.recordVisit(residentId, topic.trim());
      setResidentId('');
      setTopic('');
      setOpen(false);
      toast('Приём записан');
      onRecorded();
    } catch (reason) {
      setError(describeFailure(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Group>
        <CellSimple
          before={
            <span className="tile tile-blue">
              <IconPerson />
            </span>
          }
          title="Записать пришедшего"
          subtitle="Жилец пришёл без записи"
          height="compact"
          showChevron
          onClick={() => setOpen(true)}
        />
      </Group>
    );
  }

  return (
    <Group title="Пришёл без записи">
      <div className="field-row">
        <label className="cell-label" htmlFor="walk-in-resident">
          Кто пришёл
        </label>
        {/* Жильцы не дошли: пустой список без этой строки читается как «в доме никого». */}
        {residents.length === 0 && people.error ? (
          <RetryLink title="Список жильцов не загрузился" onRetry={people.reload} />
        ) : null}

        <select id="walk-in-resident" value={residentId} onChange={(event) => setResidentId(event.target.value)}>
          <option value="">Выберите жильца</option>
          {residents.map((person) => (
            <option key={person.id} value={person.id}>
              {person.apartmentNumber === undefined
                ? person.displayName
                : `${person.displayName} · кв. ${person.apartmentNumber}`}
            </option>
          ))}
        </select>
      </div>

      <CellInput
        className="field-row"
        id="walk-in-topic"
        aria-label="С чем пришёл"
        placeholder="Перерасчёт за горячую воду"
        before={<span className="cell-label">С чем пришёл</span>}
        value={topic}
        onChange={(event) => setTopic(event.target.value)}
      />

      <CellAction
        mode="primary"
        disabled={busy || residentId === '' || topic.trim().length === 0}
        onClick={() => void record()}
      >
        {busy ? 'Записываем…' : 'Записать приём'}
      </CellAction>
      <CellAction mode="secondary" disabled={busy} onClick={() => setOpen(false)}>
        Отмена
      </CellAction>

      {error ? <ErrorText className="inset">{error}</ErrorText> : null}
    </Group>
  );
};

/** Записи дома: их ведёт смена. */
const StaffVisits = ({ api, canSchedule }: { api: DomovoyApi; canSchedule?: boolean }) => {
  const visits = useBridgeRequest((alive) => api.until(alive).visits(), [api]);
  const reception = useBridgeRequest(
    (alive) => api.until(alive).reception().catch((): ReceptionView | null => null),
    [api],
  );
  const [saved, setSaved] = useState<ReceptionView | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // Отмена записи касается жильца, который уже отпросился с работы: спрашиваем.
  const [cancelling, setCancelling] = useState<{ id: string; title: string } | null>(null);

  if (visits.loading && !visits.data) return <Skeleton count={3} />;

  if (visits.error || !visits.data) {
    return <Failure title="Записи не загрузились" error={visits.error} onRetry={visits.reload} />;
  }

  const view = saved ?? reception.data;
  const hours = view?.hours;

  const head = (
    <>
      {canSchedule ? (
        <Hours
          api={api}
          {...(hours ? { hours } : {})}
          {...(view?.windows?.length ? { known: view.windows } : {})}
          onSaved={setSaved}
        />
      ) : hours ? (
        <p className="hint aside">Часы приёма: {hours}</p>
      ) : null}

      <WalkIn api={api} onRecorded={visits.reload} />
    </>
  );

  if (visits.data.length === 0) {
    return (
      <section className="list">
        {head}

        <Empty
          icon={<IconCalendar />}
          title="Записей нет"
          hint="Жильцы выбирают время сами, из часов приёма дома"
        />
      </section>
    );
  }

  const run = async (id: string, what: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(id);

    try {
      await what();
      toast(done);
      visits.reload();
    } catch (reason) {
      toast(describeFailure(reason), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="list">
      {head}

      {visits.data.map((visit) => (
        <CellList key={visit.id} mode="island">
          <CellSimple
            before={
              <span className="tile tile-green">
                <IconPerson />
              </span>
            }
            title={`${visit.day}, ${visit.clock} · ${who(visit)}`}
            subtitle={visit.topic}
          />
          <CellAction
            mode="primary"
            disabled={busy === visit.id}
            onClick={() => void run(visit.id, () => api.completeVisit(visit.id), 'Приём отмечен')}
          >
            Приём состоялся
          </CellAction>
          <CellAction
            mode="secondary"
            disabled={busy === visit.id}
            onClick={() => setCancelling({ id: visit.id, title: `${visit.day}, ${visit.clock} · ${who(visit)}` })}
          >
            Отменить
          </CellAction>
        </CellList>
      ))}

      {cancelling ? (
        <Confirm
          title="Отменить запись жильца?"
          text={`${cancelling.title}. Жилец получит сообщение, что приём отменён.`}
          confirmLabel="Отменить запись"
          busy={busy === cancelling.id}
          danger
          onCancel={() => setCancelling(null)}
          onConfirm={() => {
            const { id } = cancelling;

            setCancelling(null);
            void run(id, () => api.cancelVisit(id), 'Запись отменена');
          }}
        />
      ) : null}
    </section>
  );
};

/** Свободные часы и своя запись: их выбирает жилец. */
const ResidentVisits = ({ api, onSupport }: { api: DomovoyApi; onSupport?: () => void }) => {
  const reception = useBridgeRequest((alive) => api.until(alive).reception(), [api]);
  const toast = useToast();
  const haptics = useHaptics();
  const [chosen, setChosen] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  // Отмена спрашивается: время приёма человек уже, возможно, выпросил у работы.
  const [cancelling, setCancelling] = useState(false);

  if (reception.loading && !reception.data) return <Skeleton count={3} />;

  if (reception.error || !reception.data) {
    return <Failure title="Приём не загрузился" error={reception.error} onRetry={reception.reload} />;
  }

  const view: ReceptionView = reception.data;

  const book = async (): Promise<void> => {
    if (!chosen || topic.trim().length === 0) return;

    setBusy(true);

    try {
      await api.bookVisit(chosen, topic.trim());
      haptics.done();
      toast('Записали на приём');
      setChosen(null);
      setTopic('');
      reception.reload();
    } catch (reason) {
      haptics.failed();
      toast(describeFailure(reason), 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!view.mine) return;

    setBusy(true);

    try {
      await api.cancelVisit(view.mine.id);
      setCancelling(false);
      toast('Запись отменена');
      reception.reload();
    } catch (reason) {
      toast(describeFailure(reason), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (view.mine) {
    return (
      <section className="list">
        <Group title="Вы записаны">
          <CellSimple
            before={
              <span className="tile tile-green">
                <IconCalendar />
              </span>
            }
            title={`${view.mine.day}, ${view.mine.clock}`}
            subtitle={view.mine.topic}
          />
          {view.office ? <CellSimple title="Адрес" subtitle={view.office} height="compact" separator /> : null}
          <CellAction mode="destructive" disabled={busy} onClick={() => setCancelling(true)}>
            Отменить запись
          </CellAction>
        </Group>

        {cancelling ? (
          <Confirm
            title="Отменить запись?"
            text={`${view.mine.day}, ${view.mine.clock}. Время освободится для других, записаться снова можно будет на свободный час.`}
            confirmLabel="Отменить запись"
            busyLabel="Отменяем…"
            busy={busy}
            danger
            onConfirm={() => void cancel()}
            onCancel={() => setCancelling(false)}
          />
        ) : null}
      </section>
    );
  }

  if (view.slots.length === 0) {
    return (
      <Empty
        icon={<IconCalendar />}
        title={view.hours ? 'Свободных часов нет' : 'Приём по записи не ведётся'}
        hint={view.hours ? 'Загляните через несколько дней' : undefined}
      >
        {view.hours || !onSupport ? null : (
          <Button type="button" onClick={onSupport}>
            Задать вопрос
          </Button>
        )}
      </Empty>
    );
  }

  const days = [...new Set(view.slots.map((slot) => slot.day))];
  const picked = view.slots.find((slot) => slot.at === chosen);

  // Форма стоит под выбранным днём, а не в конце списка: выбранный час виден рядом с ней.
  const form = picked ? (
    <Group title="С чем придёте">
      <CellSimple
        before={
          <span className="tile tile-green">
            <IconCalendar />
          </span>
        }
        title={`${picked.day}, ${picked.clock}`}
        subtitle="Выбранное время"
        height="compact"
      />
      <CellInput
        className="field-row"
        id="visit-topic"
        aria-label="С чем придёте"
        placeholder="Перерасчёт за горячую воду"
        value={topic}
        onChange={(event) => setTopic(event.target.value)}
      />
      <CellAction mode="primary" disabled={busy || topic.trim().length === 0} onClick={() => void book()}>
        {busy ? 'Записываем…' : 'Записаться'}
      </CellAction>
    </Group>
  ) : null;

  return (
    <section className="list">
      {view.hours ? (
        <p className="hint aside">
          {view.office ? `${view.office} · ${view.hours}` : view.hours}
        </p>
      ) : null}

      <p className="hint aside">Выберите час</p>

      {days.map((day) => (
        <div key={day} className="list">
          <Group title={day}>
            <div className="chips">
              {view.slots
                .filter((slot) => slot.day === day)
                .map((slot) => (
                  <button
                    key={slot.at}
                    type="button"
                    className={chosen === slot.at ? 'chip chip-on' : 'chip'}
                    aria-pressed={chosen === slot.at}
                    onClick={() => {
                      haptics.picked();
                      setChosen(slot.at);
                    }}
                  >
                    {slot.clock}
                  </button>
                ))}
            </div>
          </Group>

          {picked?.day === day ? form : null}
        </div>
      ))}
    </section>
  );
};

/** Приём в управляющей организации. */
export const VisitsScreen = ({ api, staff, onSupport, canSchedule }: VisitsScreenProps) =>
  staff ? (
    <StaffVisits api={api} {...(canSchedule ? { canSchedule } : {})} />
  ) : (
    <ResidentVisits api={api} {...(onSupport ? { onSupport } : {})} />
  );
