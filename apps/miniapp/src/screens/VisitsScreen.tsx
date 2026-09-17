import { Button, CellAction, CellInput, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, type DomovoyApi, type ReceptionView, type VisitView } from '../api.js';
import { useHaptics } from '../haptics.js';
import { useToast } from '../toast.js';
import { Empty } from './Empty.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconCalendar, IconPerson } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface VisitsScreenProps {
  api: DomovoyApi;
  /** Смена видит записи дома, жилец записывается сам. */
  staff?: boolean;
  /** Уйти в поддержку: приём ведут не все организации, а вопрос есть всегда. */
  onSupport?: () => void;
}

/** Кто записан: имя и квартира. */
const who = (visit: VisitView): string =>
  [visit.residentName ?? 'Жилец', visit.apartment === undefined ? '' : `кв. ${visit.apartment}`]
    .filter(Boolean)
    .join(', ');

/** Записи дома: их ведёт смена. */
const StaffVisits = ({ api }: { api: DomovoyApi }) => {
  const visits = useBridgeRequest(() => api.visits(), [api]);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (visits.loading && !visits.data) return <Skeleton count={3} />;

  if (visits.error || !visits.data) {
    return <Failure title="Записи не загрузились" error={visits.error} onRetry={visits.reload} />;
  }

  if (visits.data.length === 0) {
    return <Empty icon={<IconCalendar />} title="Записей нет" hint="Жильцы записываются на приём сами" />;
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
            onClick={() => void run(visit.id, () => api.cancelVisit(visit.id), 'Запись отменена')}
          >
            Отменить
          </CellAction>
        </CellList>
      ))}
    </section>
  );
};

/** Свободные часы и своя запись: их выбирает жилец. */
const ResidentVisits = ({ api, onSupport }: { api: DomovoyApi; onSupport?: () => void }) => {
  const reception = useBridgeRequest(() => api.reception(), [api]);
  const toast = useToast();
  const haptics = useHaptics();
  const [chosen, setChosen] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);

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
          <CellAction mode="destructive" disabled={busy} onClick={() => void cancel()}>
            Отменить запись
          </CellAction>
        </Group>
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

  return (
    <section className="list">
      {view.hours ? (
        <p className="hint aside">
          {view.office ? `${view.office} · ${view.hours}` : view.hours}
        </p>
      ) : null}

      <p className="hint aside">Выберите свободный час: запись подтвердится сразу.</p>

      {days.map((day) => (
        <Group key={day} title={day}>
          <div className="chips">
            {view.slots
              .filter((slot) => slot.day === day)
              .map((slot) => (
                <button
                  key={slot.at}
                  type="button"
                  className={chosen === slot.at ? 'chip chip-on' : 'chip'}
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
      ))}

      {chosen ? (
        <Group title="С чем придёте">
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
      ) : null}
    </section>
  );
};

/** Приём в управляющей организации. */
export const VisitsScreen = ({ api, staff, onSupport }: VisitsScreenProps) =>
  staff ? <StaffVisits api={api} /> : <ResidentVisits api={api} {...(onSupport ? { onSupport } : {})} />;
