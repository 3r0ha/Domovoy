import { Button, CellList, CellSimple, Input } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useMemo, useState } from 'react';

import { actionTitle, describeFailure, type DomovoyApi, type RequestView } from '../api.js';
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
  /** Счётчик изменений заявки: по нему очередь перечитывается. */
  version?: number;
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

interface Summary {
  counts: { overdue: number; new: number; unassigned: number };
  categories: { category: string; title: string; count: number }[];
}

/** Сколько заявок под каждым отбором. Один проход по очереди вместо перебора на каждый отбор. */
const summarize = (all: readonly RequestView[]): Summary => {
  const counts = { overdue: 0, new: 0, unassigned: 0 };
  const byCategory = new Map<string, { category: string; title: string; count: number }>();

  for (const request of all) {
    if (request.overdue) counts.overdue += 1;
    if (request.status === 'new') counts.new += 1;
    if (unassigned(request)) counts.unassigned += 1;

    const seen = byCategory.get(request.category);

    if (seen) seen.count += 1;
    else {
      byCategory.set(request.category, {
        category: request.category,
        title: request.categoryShort ?? request.categoryTitle,
        count: 1,
      });
    }
  }

  return { counts, categories: [...byCategory.values()] };
};

/** Очередь дома: просроченное сверху, дальше по сроку. */
export const QueueScreen = ({ api, version, onOpen, onNewRequest, canAccept }: QueueScreenProps) => {
  const queue = useBridgeRequest(() => api.listRequests('queue'), [api, version]);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [limit, setLimit] = useState(QUEUE_PAGE);
  const [query, setQuery] = useState('');
  const [taking, setTaking] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const haptics = useHaptics();

  // Порядок задаёт сервер: он же и считает, какой срок у заявки ближайший.
  const all = queue.data ?? [];

  // Отборы считаются по данным, а не по каждой набранной в поиске букве.
  const { counts, categories } = useMemo(() => summarize(all), [all]);

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
          withClearButton
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
                      title: taking === request.id ? '…' : actionTitle('accepted'),
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
