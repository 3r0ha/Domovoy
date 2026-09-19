import { Button, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState, type ReactNode } from 'react';

import { ApiError, formatPublished, hours, type DomovoyApi, type PeriodSummaryView } from '../api.js';
import { CategoryTile } from './CategoryTile.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { useToast } from '../toast.js';
import { Skeleton } from './Skeleton.js';

export interface ReportScreenProps {
  api: DomovoyApi;
  /** Файлы доходят до переписки: без этого остаётся только скачивание. */
  toChat?: boolean;
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** За какие промежутки смотрят сводку: месяц работы, квартал и год. */
const PERIODS: { days: number; title: string }[] = [
  { days: 30, title: 'Месяц' },
  { days: 90, title: 'Квартал' },
  { days: 365, title: 'Год' },
];

/** Сравнение с таким же промежутком перед этим. */
const Change = ({
  value,
  before,
  better,
  format,
}: {
  value: number;
  /** Куда лучше: в большую или в меньшую сторону. */
  better?: 'more' | 'less';
  before: number;
  format?: (value: number) => string;
}) => {
  if (value === before) return null;

  const grew = value > before;
  const tone = better === undefined ? '' : grew === (better === 'more') ? ' change-good' : ' change-bad';

  return (
    <span className={`change${tone}`}>
      {grew ? '↑' : '↓'} было {format ? format(before) : before}
    </span>
  );
};

const Row = ({
  title,
  value,
  hint,
  before,
}: {
  title: string;
  value: ReactNode;
  hint?: ReactNode;
  before?: ReactNode;
}) => (
  <CellSimple
    {...(before ? { before } : {})}
    title={title}
    subtitle={hint}
    after={<span className="report-value">{value}</span>}
    separator
    height="compact"
  />
);

/** Строки списка: слева показатель, справа число. */
const Rows = ({ header, children }: { header: string; children: ReactNode }) => (
  <Group title={header}>{children}</Group>
);

/** Заявки по суткам столбиками. */
const Pulse = ({ daily, days }: { daily: readonly number[]; days: number }) => {
  const peak = Math.max(...daily, 1);

  if (daily.length < 2) return null;

  const total = daily.reduce((sum, day) => sum + day, 0);

  return (
    <div className="pulse-box">
      <p className="pulse-title hint">
        Обращений по дням, всего {total} · в самый шумный день {peak}
      </p>

      <p className="pulse" aria-label={`Заявки по дням, всего ${total}`}>
        {daily.map((count, index) => (
          <span key={index} title={`${count}`} style={{ height: `${Math.round((count / peak) * 100)}%` }} />
        ))}
      </p>

      <p className="pulse-axis hint">
        <span>{days} дней назад</span>
        <span>сегодня</span>
      </p>
    </div>
  );
};

const PeriodRows = ({ period, previous }: { period: PeriodSummaryView; previous: PeriodSummaryView }) => (
  <>

    <Row title="Подано" value={period.created} hint={<Change value={period.created} before={previous.created} />} />
    <Row
      title="Закрыто"
      value={period.closed}
      hint={<Change value={period.closed} before={previous.closed} better="more" />}
    />
    <Row
      title="В срок"
      value={period.closed === 0 ? 'нет данных' : percent(period.inTimeRate)}
      hint={
        previous.closed > 0 && period.closed > 0 ? (
          <Change value={period.inTimeRate} before={previous.inTimeRate} better="more" format={percent} />
        ) : undefined
      }
    />
    <Row
      title="Среднее время"
      value={period.closed === 0 ? 'нет данных' : hours(period.averageHours)}
      hint={
        previous.averageHours > 0 && period.closed > 0 ? (
          <Change value={period.averageHours} before={previous.averageHours} better="less" format={hours} />
        ) : undefined
      }
    />
    <Row
      title="Оценка жильцов"
      value={period.rated ? `${period.averageRating} из 5` : 'не оценивали'}
      hint={period.rated ? `оценок ${period.rated}` : undefined}
    />
    <Row title="Склеено обращений" value={period.mergedReports} />
  </>
);

/** Реестр собирается на сервере: запрос идёт с токеном сессии. */
const Export = ({ api, days, toChat }: { api: DomovoyApi; days: number; toChat: boolean }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const run = async (what: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await what();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось выгрузить реестр');
    } finally {
      setBusy(false);
    }
  };

  const download = (): Promise<void> =>
    run(async () => {
      const { filename, blob } = await api.exportRequests(days);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = filename;
      link.click();

      URL.revokeObjectURL(url);
      toast('Файл сохранён');
    });

  // Клиент MAX не всегда даёт сохранить файл из приложения, поэтому тот же
  // реестр уходит в переписку с ботом: оттуда его открывают и пересылают.
  const send = (): Promise<void> =>
    run(async () => {
      await api.sendRequestsExport(days);
      toast('Реестр отправлен в чат с ботом');
    });

  return (
    <>
      {toChat ? (
        <CellSimple
          title={busy ? 'Собираем реестр…' : 'Прислать в переписку с ботом'}
          subtitle={error ? <span className="error">{error}</span> : 'Оттуда файл пересылают в любой чат'}
          showChevron={!busy}
          height="compact"
          onClick={() => void send()}
        />
      ) : null}
      <CellSimple
        title={busy && !toChat ? 'Собираем реестр…' : 'Выгрузить в Excel'}
        subtitle={!toChat && error ? <span className="error">{error}</span> : undefined}
        showChevron={!busy}
        height="compact"
        separator={toChat}
        onClick={() => void download()}
      />
    </>
  );
};

/** Сводка по дому. */
export const ReportScreen = ({ api, toChat }: ReportScreenProps) => {
  const [days, setDays] = useState(30);
  const report = useBridgeRequest((alive) => api.until(alive).report(days), [api, days]);
  // Пересказ идёт своим запросом: числа появляются сразу, а он подтягивается следом.
  const digest = useBridgeRequest(
    (alive) => api.until(alive).reportDigest(days).catch((): { digest?: string; basis?: string } => ({})),
    [api, days],
  );

  if (report.loading && !report.data) return <Skeleton count={2} />;

  if (!report.data) {
    return <Failure title="Сводка недоступна" error={report.error} onRetry={report.reload} />;
  }

  const { summary, period, previous, incidents, categories, assignees, objects, inspections } = report.data;
  const failing = categories.filter((category) => category.overdue > 0);
  const returned = assignees.filter((assignee) => assignee.reopened > 0);
  const rated = assignees.filter((assignee) => assignee.rated > 0);
  const withSite = assignees.filter((assignee) => assignee.completed > 0);
  const proved = withSite.some((assignee) => assignee.onSite > 0) ? withSite : [];
  const periodTitle = PERIODS.find((item) => item.days === days)?.title ?? `${days} дн.`;

  return (
    <section className="list">
      {digest.data?.digest ? (
        <>
          <p className="lead">{digest.data.digest}</p>
          {digest.data.basis ? <p className="hint aside">{digest.data.basis}</p> : null}
        </>
      ) : null}

      {(report.data.handoffs ?? []).length > 0 ? (
        <Group title="Передано и ждёт ответа">
          {(report.data.handoffs ?? []).map((handoff) => (
            <CellSimple
              key={handoff.id}
              title={handoff.organization}
              subtitle={`${handoff.statusTitle} · ответ до ${formatPublished(handoff.dueAt)}`}
              after={handoff.overdue ? <span className="dot dot-bad" /> : null}
              separator={false}
            />
          ))}
        </Group>
      ) : null}

      <Rows header="Дом сейчас">
        <Row title="Открыто" value={summary.open} />
        <Row
          title="Просрочено"
          value={<span className={summary.overdue > 0 ? 'overdue' : undefined}>{summary.overdue}</span>}
        />
      </Rows>

      <div className="filters">
        {PERIODS.map((item) => (
          <Button
            key={item.days}
            type="button"
            size="small"
            variant={item.days === days ? 'primary' : 'secondary'}
            aria-pressed={item.days === days}
            disabled={report.loading}
            onClick={() => setDays(item.days)}
          >
            {item.title}
          </Button>
        ))}
      </div>

      <Pulse daily={report.data.daily ?? []} days={days} />

      <CellList mode="island">
        <PeriodRows period={period} previous={previous} />
        <Export api={api} days={days} toChat={toChat !== false} />
      </CellList>

      {incidents.length > 0 ? (
        <Rows header="Авария: несколько обращений">
          {incidents.map((incident) => (
            <CellSimple
              key={incident.requestId}
              title={incident.title}
              subtitle={[incident.target, `сообщили ${incident.reporters}`].filter(Boolean).join(' · ')}
              separator
            />
          ))}
        </Rows>
      ) : null}

      {failing.length > 0 ? (
        <Rows header={`Не укладываемся за ${periodTitle.toLowerCase()}`}>
          {failing.map((category) => (
            <Row
              key={category.category}
              before={<CategoryTile category={category.category} />}
              title={category.title}
              value={percent(category.overdueRate)}
              hint={`${category.overdue} из ${category.total}`}
            />
          ))}
        </Rows>
      ) : null}

      {returned.length > 0 ? (
        <Rows header="Работы не приняли">
          {returned.map((assignee) => (
            <Row
              key={assignee.assigneeId}
              title={assignee.displayName}
              value={percent(assignee.reopenRate)}
              hint={`${assignee.reopened} из ${assignee.completed}`}
            />
          ))}
        </Rows>
      ) : null}

      {proved.length > 0 ? (
        <Rows header="Закрыто с выездом">
          {[...proved]
            .sort((left, right) => left.onSite / left.completed - right.onSite / right.completed)
            .map((assignee) => (
              <Row
                key={assignee.assigneeId}
                title={assignee.displayName}
                value={percent(assignee.onSite / assignee.completed)}
                hint={`${assignee.onSite} из ${assignee.completed}`}
              />
            ))}
        </Rows>
      ) : null}

      {rated.length > 0 ? (
        <Rows header="Оценки жильцов">
          {[...rated]
            .sort((left, right) => right.averageRating - left.averageRating)
            .map((assignee) => (
              <Row
                key={assignee.assigneeId}
                title={assignee.displayName}
                value={`${Math.round(assignee.averageRating * 10) / 10} из 5`}
                hint={`оценок ${assignee.rated}`}
              />
            ))}
        </Rows>
      ) : null}

      {inspections && (inspections.finished > 0 || inspections.overdue > 0) ? (
        <Rows header="Осмотры общего имущества">
          <Row title="Закончено" value={inspections.finished} hint="за период" />
          {inspections.overdue > 0 ? <Row title="Просрочено" value={inspections.overdue} hint="срок вышел" /> : null}
          {inspections.found > 0 ? <Row title="Нашли недостатков" value={inspections.found} hint="стали заявками" /> : null}
        </Rows>
      ) : null}

      {objects.length > 0 ? (
        <Rows header="Ломается чаще прочего">
          {objects.map((object) => (
            <Row key={object.title} title={object.title} value={object.requests} hint="обращений" />
          ))}
        </Rows>
      ) : null}
    </section>
  );
};
