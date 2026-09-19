import { Button, CellAction, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, type DomovoyApi, type RequestView } from '../api.js';
import { useHaptics } from '../haptics.js';
import { usePages } from '../use-pages.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { HouseAhead } from './HouseAhead.js';
import { HouseNow } from './HouseNow.js';
import { HouseRequests } from './HouseRequests.js';
import { RequestRow } from './RequestRow.js';
import { Skeleton } from './Skeleton.js';
import { IconRequests } from './icons.js';

export interface RequestListScreenProps {
  api: DomovoyApi;
  /** У сотрудника в списке порученная ему работа. */
  staff?: boolean;
  /** Счётчик изменений заявки: по нему список перечитывается. */
  version?: number;
  /** Перейти к оформлению заявки. */
  onNewRequest?: () => void;
  /** Уйти в очередь дома: без своих нарядов работа начинается оттуда. */
  onQueue?: () => void;
  /** Открыть заявку на её экране. */
  onOpen: (id: string) => void;
}

/** Сколько закрытых заявок приходит за раз, как и на сервере. */
const PAGE = 20;

const Rows = ({
  requests,
  staff,
  title,
  starting,
  onStart,
  onOpen,
}: {
  requests: RequestView[];
  staff?: boolean;
  title?: string;
  /** Наряд, который сейчас берут: повторное нажатие ничего не отправляет. */
  starting?: string | null;
  /** Взять наряд в работу прямо из списка. */
  onStart?: (id: string) => void;
  onOpen: (id: string) => void;
}) => (
  <Group {...(title ? { title } : {})}>
    {requests.map((request, index) => (
      <RequestRow
        key={request.id}
        request={request}
        separator={index > 0}
        {...(staff ? { staff } : {})}
        {...(onStart && request.status === 'accepted'
          ? {
              action: {
                title: starting === request.id ? 'Берём…' : 'В работу',
                busy: starting !== null && starting !== undefined,
                run: () => onStart(request.id),
              },
            }
          : {})}
        onOpen={() => onOpen(request.id)}
      />
    ))}
  </Group>
);

/** Список своих заявок: самое срочное сверху, порядок задаёт сервер. */
export const RequestListScreen = ({
  api,
  staff,
  version,
  onNewRequest,
  onQueue,
  onOpen,
}: RequestListScreenProps) => {
  const requests = useBridgeRequest((alive) => api.until(alive).listRequests('mine'), [api, version]);
  const [showClosed, setShowClosed] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const haptics = useHaptics();

  /**
   * Наряд берут в работу одним нажатием: закрывает его мастер на экране заявки,
   * где есть снимок и отметка о выезде.
   */
  const start = async (id: string): Promise<void> => {
    setFailed(null);
    setStarting(id);

    try {
      await api.transition(id, 'in_progress');
      haptics.done();
      requests.reload();
    } catch (error: unknown) {
      haptics.failed();
      setFailed(describeFailure(error));
    } finally {
      setStarting(null);
    }
  };

  /** Закрытые заявки читаются страницами и только по запросу. */
  const closed = usePages<RequestView>((cursor) => api.listRequests('closed', cursor), PAGE);
  const readClosed = (): void => closed.more(closed.items.at(-1)?.createdAt);

  const create =
    !staff && onNewRequest ? (
      <Button type="button" size="large" stretched data-guide="new" onClick={onNewRequest}>
        Оставить заявку
      </Button>
    ) : null;

  if (requests.loading && !requests.data) return <Skeleton />;

  if (requests.error) {
    return <Failure title="Заявки не загрузились" error={requests.error} onRetry={requests.reload} />;
  }

  const now = staff ? null : <HouseNow api={api} onOpen={onOpen} />;

  const active = requests.data ?? [];

  return (
    <section className="list">
      {now}
      {active.length > 0 ? create : null}

      {failed ? <ErrorText>{failed}</ErrorText> : null}

      {active.length === 0 ? (
        staff ? (
          <Empty
            mood="sleeping"
            title="Нарядов нет"
            {...(onQueue ? { hint: 'Работа начинается с очереди дома' } : {})}
          >
            {onQueue ? (
              <>
                <Button type="button" size="large" onClick={onQueue}>
                  В очередь
                </Button>

                {onNewRequest ? (
                  <button type="button" className="link" onClick={onNewRequest}>
                    Заявка по звонку
                  </button>
                ) : null}
              </>
            ) : null}
          </Empty>
        ) : (
          <Empty icon={<IconRequests />} title="Открытых заявок нет" hint="Расскажите, что случилось">
            {create}
          </Empty>
        )
      ) : (
        <Rows
          requests={active}
          staff={staff}
          title={staff ? 'Ваши наряды' : 'Ваши заявки'}
          {...(staff ? { starting, onStart: (id: string) => void start(id) } : {})}
          onOpen={onOpen}
        />
      )}

      <Group>
        <CellSimple
          className={showClosed ? 'row-open' : ''}
          title={staff ? 'Закрытые наряды' : 'Закрытые заявки'}
          showChevron
          height="compact"
          onClick={() => {
            setShowClosed(!showClosed);
            if (!showClosed) readClosed();
          }}
        />

        {showClosed
          ? closed.items.map((request, index) => (
              <RequestRow
                key={request.id}
                request={request}
                separator={index > 0}
                {...(staff ? { staff } : {})}
                onOpen={() => onOpen(request.id)}
              />
            ))
          : null}

        {showClosed && closed.done && closed.items.length === 0 ? (
          <CellSimple title="Пусто" height="compact" separator />
        ) : null}

        {showClosed && closed.started && !closed.done ? (
          <CellAction mode="secondary" disabled={closed.loading} onClick={readClosed}>
            {closed.error ? `${closed.error}. Повторить` : closed.loading ? 'Загружаем…' : 'Показать ещё'}
          </CellAction>
        ) : null}
      </Group>

      {staff ? null : <HouseRequests api={api} onOpen={onOpen} />}

      {staff ? null : <HouseAhead api={api} />}
    </section>
  );
};
