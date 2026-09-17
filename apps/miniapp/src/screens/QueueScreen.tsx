import { Button, CellList, CellSimple, Input } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, type DomovoyApi, type RequestView } from '../api.js';
import { Empty } from './Empty.js';
import { Group } from './Group.js';
import { IconRequests } from './icons.js';
import { More } from './More.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { RequestRow } from './RequestRow.js';
import { Skeleton } from './Skeleton.js';
import { useHaptics } from '../haptics.js';

export interface QueueScreenProps {
  api: DomovoyApi;
  /** Открыть заявку на её экране. */
  onOpen: (id: string) => void;
  /** Оформить обращение самому, например по телефонному звонку жильца. */
  onNewRequest?: () => void;
  /** Принимать заявки вправе диспетчер и управляющий: мастеру кнопки не будет. */
  canAccept?: boolean;
}

/** Отбор задаётся кодом категории либо состоянием очереди, либо ничем. */
type Filter =
  | { kind: 'all' }
  | { kind: 'overdue' }
  | { kind: 'new' }
  | { kind: 'unassigned' }
  | { kind: 'category'; category: string };

/** Заявка принята, но исполнителя у неё нет: её легко потерять из виду. */
const unassigned = (request: RequestView): boolean =>
  !request.assigneeId && (request.status === 'accepted' || request.status === 'needs_info');

const matches = (request: RequestView, filter: Filter): boolean => {
  if (filter.kind === 'all') return true;
  if (filter.kind === 'overdue') return request.overdue;
  if (filter.kind === 'new') return request.status === 'new';
  if (filter.kind === 'unassigned') return unassigned(request);

  return request.category === filter.category;
};

/** Сколько заявок очереди показывается сразу: остальные дочитываются кнопкой. */
const QUEUE_PAGE = 20;

/** Поиск идёт по номеру, адресу и сути сразу. */
const found = (request: RequestView, query: string): boolean => {
  const needle = query.trim().toLowerCase();

  if (needle.length === 0) return true;

  return [request.number, request.title, request.description, request.target, request.categoryTitle]
    .join('\n')
    .toLowerCase()
    .includes(needle);
};

/** Очередь дома: просроченное сверху, дальше по сроку. */
export const QueueScreen = ({ api, onOpen, onNewRequest, canAccept }: QueueScreenProps) => {
  const queue = useBridgeRequest(() => api.listRequests('queue'), [api]);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [limit, setLimit] = useState(QUEUE_PAGE);
  const [query, setQuery] = useState('');
  const [taking, setTaking] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const haptics = useHaptics();

  const choose = (next: Filter): void => {
    haptics.picked();
    setFilter(next);
    setLimit(QUEUE_PAGE);
  };

  /** Принять заявку, не открывая её: диспетчеру это первое действие по новой. */
  const accept = async (id: string): Promise<void> => {
    setTaking(id);
    setFailed(null);

    try {
      await api.transition(id, 'accepted');
      haptics.done();
      queue.reload();
    } catch (error: unknown) {
      haptics.failed();
      setFailed(describeFailure(error));
    } finally {
      setTaking(null);
    }
  };

  if (queue.loading && !queue.data) return <Skeleton />;

  if (queue.error) {
    return <Failure title="Очередь не загрузилась" error={queue.error} onRetry={queue.reload} />;
  }

  // Пустая очередь работу не заканчивает: заявку по звонку заводят и из неё.
  if (queue.data?.length === 0) {
    return (
      <div className="list">
        <Empty mood="sleeping" title="Очередь пуста" />

        {onNewRequest ? (
          <Group>
            <CellSimple
              before={
                <span className="tile tile-blue">
                  <IconRequests />
                </span>
              }
              title="Заявка по звонку"
              subtitle="Жилец позвонил, а не написал"
              showChevron
              height="compact"
              onClick={onNewRequest}
            />
          </Group>
        ) : null}
      </div>
    );
  }

  const all = queue.data ?? [];

  const counts = {
    overdue: all.filter((request) => request.overdue).length,
    new: all.filter((request) => request.status === 'new').length,
    unassigned: all.filter(unassigned).length,
  };

  const categories = [...new Map(all.map((request) => [request.category, request])).values()].map((request) => ({
    category: request.category,
    title: request.categoryShort ?? request.categoryTitle,
    count: all.filter((item) => item.category === request.category).length,
  }));

  const matching = all.filter((request) => matches(request, filter) && found(request, query));
  const shown = matching.slice(0, limit);
  const rest = matching.length - shown.length;

  /** Отборы очереди: те, под которыми есть заявки. */
  const picks: { kind: Exclude<Filter, { kind: 'category' }>['kind']; title: string; count: number }[] = [
    { kind: 'all', title: 'Все', count: all.length },
    { kind: 'overdue', title: 'Просрочено', count: counts.overdue },
    { kind: 'new', title: 'Новые', count: counts.new },
    { kind: 'unassigned', title: 'Без мастера', count: counts.unassigned },
  ];

  return (
    <section className="list">
      <article className="card card-tools">
        <Input
          className="field"
          id="queue-search"
          type="search"
          aria-label="Поиск по очереди"
          value={query}
          placeholder="Номер, адрес или суть"
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(QUEUE_PAGE);
          }}
        />

        <div className="filters">
          {picks
            .filter((pick) => pick.kind === 'all' || pick.count > 0)
            .map((pick) => (
              <Button
                key={pick.kind}
                type="button"
                size="small"
                variant={filter.kind === pick.kind ? 'primary' : 'secondary'}
                aria-pressed={filter.kind === pick.kind}
                onClick={() => choose({ kind: pick.kind })}
              >
                {pick.title} · {pick.count}
              </Button>
            ))}

          {categories.map(({ category, title, count }) => {
            const active = filter.kind === 'category' && filter.category === category;

            return (
              <Button
                key={category}
                type="button"
                size="small"
                variant={active ? 'primary' : 'secondary'}
                aria-pressed={active}
                onClick={() => choose({ kind: 'category', category })}
              >
                {title} · {count}
              </Button>
            );
          })}
        </div>
      </article>

      {onNewRequest ? (
        <Group>
          <CellSimple
            before={
              <span className="tile tile-blue">
                <IconRequests />
              </span>
            }
            title="Заявка по звонку"
            subtitle="Жилец позвонил, а не написал"
            showChevron
            height="compact"
            onClick={onNewRequest}
          />
        </Group>
      ) : null}

      {failed ? <ErrorText>{failed}</ErrorText> : null}

      {shown.length === 0 ? <p className="lead">Ничего не нашлось</p> : null}

      {shown.length > 0 ? (
        <CellList mode="island">
          {shown.map((request, index) => (
            <RequestRow
              key={request.id}
              request={request}
              separator={index > 0}
              staff
              {...(canAccept && request.status === 'new'
                ? {
                    action: {
                      title: taking === request.id ? '…' : 'Принять',
                      busy: taking !== null,
                      run: () => void accept(request.id),
                    },
                  }
                : {})}
              onOpen={() => onOpen(request.id)}
            />
          ))}
        </CellList>
      ) : null}

      {rest > 0 ? (
        <More loading={false} error={null} onMore={() => setLimit((current) => current + QUEUE_PAGE)} />
      ) : null}
    </section>
  );
};
