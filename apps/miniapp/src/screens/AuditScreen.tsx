import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import { formatDay, formatTime, type AuditEntryView, type DomovoyApi } from '../api.js';
import { usePages } from '../use-pages.js';
import { Empty } from './Empty.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { More } from './More.js';
import { IconQueue } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface AuditScreenProps {
  api: DomovoyApi;
}

/** Сколько записей приходит за раз, как и на сервере. */
const PAGE = 50;

const title = (entry: AuditEntryView): string =>
  entry.subject ? `${entry.actionTitle} · ${entry.subject}` : entry.actionTitle;

/** Записи разбиваются по дням. */
const byDay = (entries: AuditEntryView[]): { day: string; entries: AuditEntryView[] }[] => {
  const days: { day: string; entries: AuditEntryView[] }[] = [];

  for (const entry of entries) {
    const day = formatDay(entry.at);
    const last = days.at(-1);

    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }

  return days;
};

/** Журнал действий сотрудников. */
export const AuditScreen = ({ api }: AuditScreenProps) => {
  const audit = useBridgeRequest((alive) => api.until(alive).audit(), [api]);
  const older = usePages<AuditEntryView>((cursor) => api.audit(cursor), PAGE);

  if (audit.loading && !audit.data) return <Skeleton count={3} />;

  if (audit.error || !audit.data) {
    return <Failure title="Журнал недоступен" error={audit.error} onRetry={audit.reload} />;
  }

  const entries = [...audit.data, ...older.items];

  if (entries.length === 0) {
    return <Empty icon={<IconQueue />} title="Пока тихо" hint="Здесь появятся действия сотрудников" />;
  }

  return (
    <>
      {byDay(entries).map((group) => (
        <Group key={group.day} title={group.day}>
          {group.entries.map((entry, index) => (
            <CellSimple
              key={entry.id}
              title={title(entry)}
              subtitle={`${entry.actorName} · ${formatTime(entry.at)}${entry.details ? ` · ${entry.details}` : ''}`}
              separator={index > 0}
              height="compact"
            />
          ))}
        </Group>
      ))}

      {older.done || audit.data.length < PAGE ? null : (
        <More loading={older.loading} error={older.error} onMore={() => older.more(entries.at(-1)?.at)} />
      )}
    </>
  );
};
