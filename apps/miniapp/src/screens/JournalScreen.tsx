import { CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import { formatPublished, type DomovoyApi, type DoorEventView } from '../api.js';
import { usePages } from '../use-pages.js';
import { Empty } from './Empty.js';
import { Failure } from './Failure.js';
import { More } from './More.js';
import { IconQueue } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface JournalScreenProps {
  api: DomovoyApi;
}

/** Сколько записей приходит за раз, как и на сервере. */
const PAGE = 50;

const ACTIONS: Record<DoorEventView['action'], string> = {
  opened: 'Открыто',
  snapshot: 'Смотрели камеру',
  'guest-code': 'Выдан код гостю',
};

const title = (event: DoorEventView): string => {
  const action = event.action === 'opened' && event.by === 'guest' ? 'Открыто по коду' : ACTIONS[event.action];

  return event.who ? `${action} · ${event.who}` : action;
};

/** Журнал открытий дверей и выданных кодов. */
export const JournalScreen = ({ api }: JournalScreenProps) => {
  const journal = useBridgeRequest(async () => Promise.all([api.doorJournal(), api.devices()]), [api]);
  const older = usePages<DoorEventView>((cursor) => api.doorJournal(cursor), PAGE);

  if (journal.loading && !journal.data) return <Skeleton count={3} />;

  if (journal.error || !journal.data) {
    return <Failure title="Журнал недоступен" error={journal.error} onRetry={journal.reload} />;
  }

  const [first, devices] = journal.data;
  const events = [...first, ...older.items];

  if (events.length === 0) {
    return <Empty icon={<IconQueue />} title="Пока тихо" hint="Здесь появятся открытия дверей и выданные коды" />;
  }

  const named = (deviceId: string): string => devices.find((item) => item.id === deviceId)?.title ?? deviceId;

  return (
    <>
      <CellList mode="island">
        {events.map((event, index) => (
          <CellSimple
            key={`${event.at}-${index}`}
            title={title(event)}
            subtitle={`${named(event.deviceId)} · ${formatPublished(event.at)}`}
            separator={index > 0}
            height="compact"
          />
        ))}
      </CellList>

      {older.done || first.length < PAGE ? null : (
        <More loading={older.loading} error={older.error} onMore={() => older.more(events.at(-1)?.at)} />
      )}
    </>
  );
};
