import { Button, CellAction, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { actionTitle, describeFailure, formatDue, type DomovoyApi, type RequestView } from '../api.js';
import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
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

/** Состояния, в которых заявка стоит из-за жильца, а не из-за смены. */
const WAITS_FOR_YOU = ['needs_info', 'done'];

/**
 * Главное по своим заявкам одной строкой. Жилец открывает приложение с одним
 * вопросом: что с заявкой и когда придут, а ответ лежал серой строчкой внутри
 * карточки. Порядок важности: просрочено, ждут ответа жильца, ближайший срок.
 */
const Nearest = ({ requests, onOpen }: { requests: RequestView[]; onOpen: (id: string) => void }) => {
  const t = useT();
  const overdue = requests.find((request) => request.overdue);
  const waiting = requests.find((request) => WAITS_FOR_YOU.includes(request.status));
  const soonest = [...requests]
    .filter((request) => !request.overdue && request.dueAt)
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime())[0];

  const shown = overdue ?? waiting ?? soonest;

  if (!shown) return null;

  const lead = overdue
    ? t('requests.lead.overdue')
    : waiting
      ? t(waiting.status === 'needs_info' ? 'requests.lead.answer' : 'requests.lead.accept')
      : t('requests.lead.until', { срок: formatDue(shown.dueAt) });

  return (
    <button type="button" className={overdue ? 'lead lead-late' : 'lead'} onClick={() => onOpen(shown.id)}>
      <span className="lead-line">{lead}</span>
      <span className="lead-about">{shown.title}</span>
    </button>
  );
};

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
  /** Двинуть наряд прямо из списка: взять новый или уйти в работу по принятому. */
  onStart?: (id: string, to: 'accepted' | 'in_progress') => void;
  onOpen: (id: string) => void;
}) => (
  <Group {...(title ? { title } : {})}>
    {requests.map((request, index) => {
      // Новую заявку, порученную самому мастеру, он берёт отсюда же: она уже его.
      const next = request.status === 'accepted' ? 'in_progress' : request.status === 'new' && request.assigneeId ? 'accepted' : null;

      return (
        <RequestRow
          key={request.id}
          request={request}
          separator={index > 0}
          {...(staff ? { staff } : {})}
          {...(onStart && next
            ? {
                action: {
                  title: starting === request.id ? 'Берём…' : actionTitle(next),
                  busy: starting !== null && starting !== undefined,
                  run: () => onStart(request.id, next),
                },
              }
            : {})}
          onOpen={() => onOpen(request.id)}
        />
      );
    })}
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
  const t = useT();

  /**
   * Наряд берут в работу одним нажатием: закрывает его мастер на экране заявки,
   * где есть снимок и отметка о выезде.
   */
  const start = async (id: string, to: 'accepted' | 'in_progress'): Promise<void> => {
    setFailed(null);
    setStarting(id);

    try {
      await api.transition(id, to);
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
        {t('requests.create')}
      </Button>
    ) : null;

  if (requests.loading && !requests.data) return <Skeleton />;

  if (requests.error) {
    return <Failure title={t('requests.failed')} error={requests.error} onRetry={requests.reload} />;
  }

  const now = staff ? null : <HouseNow api={api} onOpen={onOpen} />;

  const active = requests.data ?? [];

  return (
    <section className="list">
      {now}

      {/* Сначала дом, потом своё: авария объясняет и саму заявку тоже. */}
      {staff ? null : <Nearest requests={active} onOpen={onOpen} />}

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
          <Empty icon={<IconRequests />} title={t('requests.empty')} hint={t('requests.empty.hint')}>
            {create}
          </Empty>
        )
      ) : (
        <Rows
          requests={active}
          staff={staff}
          // У смены заголовок экрана уже «Наряды»: подпись «Ваши наряды» над
          // тем же списком ничего не добавляла. У жильца выше стоят заявки
          // соседей, и там разделение нужно.
          {...(staff ? {} : { title: t('requests.mine') })}
          {...(staff ? { starting, onStart: (id: string, to: 'accepted' | 'in_progress') => void start(id, to) } : {})}
          onOpen={onOpen}
        />
      )}

      <Group>
        <CellSimple
          className={showClosed ? 'row-open' : ''}
          title={staff ? 'Закрытые наряды' : t('requests.closed')}
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
          <CellSimple title={t('requests.none')} height="compact" separator />
        ) : null}

        {showClosed && closed.started && !closed.done ? (
          <CellAction mode="secondary" disabled={closed.loading} onClick={readClosed}>
            {closed.error
              ? t('requests.more.retry', { причина: closed.error })
              : closed.loading
                ? t('requests.more.loading')
                : t('requests.more')}
          </CellAction>
        ) : null}
      </Group>

      {staff ? null : <HouseRequests api={api} onOpen={onOpen} />}

      {staff ? null : <HouseAhead api={api} />}
    </section>
  );
};
