import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import type { ReactNode } from 'react';

import type { Translate } from '@domovoy/i18n';

import { formatDay, formatTime, type DomovoyApi, type HouseEventView } from '../api.js';
import { useT } from '../i18n.js';
import { Group } from './Group.js';
import { noted } from './MachineNote.js';
import { IconNews, IconPolls, IconRequests } from './icons.js';

export interface HouseAheadProps {
  api: DomovoyApi;
}

const TILE: Record<HouseEventView['kind'], string> = {
  works: 'tile-orange',
  poll: 'tile-green',
  inspection: 'tile-teal',
};

const ICON: Record<HouseEventView['kind'], () => ReactNode> = {
  works: IconNews,
  poll: IconPolls,
  inspection: IconRequests,
};

/** Что именно случится в этот момент: у работ конец, у собрания срок. */
const whenKind = (t: Translate, kind: HouseEventView['kind']): string =>
  ({
    works: t('home.ahead.works'),
    poll: t('home.ahead.poll'),
    inspection: t('home.ahead.inspection'),
  })[kind];

const when = (t: Translate, event: HouseEventView, now: Date): string => {
  const at = new Date(event.at);
  const sameDay = at.toDateString() === now.toDateString();

  return `${whenKind(t, event.kind)} ${sameDay ? formatTime(event.at) : formatDay(event.at, now)}`;
};

/** Что в доме будет на неделе: работы, собрания и обходы одной лентой. */
export const HouseAhead = ({ api }: HouseAheadProps) => {
  const t = useT();
  const ahead = useBridgeRequest((alive) => api.until(alive).houseAhead(), [api]);
  const events = Array.isArray(ahead.data) ? ahead.data : [];

  if (events.length === 0) return null;

  const now = new Date();

  return (
    <Group title={t('home.ahead')}>
      {events.map((event, index) => {
        const Icon = ICON[event.kind];

        return (
          <CellSimple
            key={`${event.kind}-${event.at}-${event.title}`}
            before={
              <span className={`tile ${TILE[event.kind]}`}>
                <Icon />
              </span>
            }
            title={event.title}
            subtitle={`${event.where} · ${when(t, event, now)}${noted(t, event.machineTranslated)}`}
            separator={index > 0}
          />
        );
      })}
    </Group>
  );
};
