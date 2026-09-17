import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import type { ReactNode } from 'react';

import { formatDay, formatTime, type DomovoyApi, type HouseEventView } from '../api.js';
import { Group } from './Group.js';
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
const WHEN: Record<HouseEventView['kind'], string> = {
  works: 'работы до',
  poll: 'голосование до',
  inspection: 'обход до',
};

const when = (event: HouseEventView, now: Date): string => {
  const at = new Date(event.at);
  const sameDay = at.toDateString() === now.toDateString();

  return `${WHEN[event.kind]} ${sameDay ? formatTime(event.at) : formatDay(event.at, now)}`;
};

/** Что в доме будет на неделе: работы, собрания и обходы одной лентой. */
export const HouseAhead = ({ api }: HouseAheadProps) => {
  const ahead = useBridgeRequest(() => api.houseAhead(), [api]);
  const events = Array.isArray(ahead.data) ? ahead.data : [];

  if (events.length === 0) return null;

  const now = new Date();

  return (
    <Group title="Скоро в доме">
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
            subtitle={`${event.where} · ${when(event, now)}`}
            separator={index > 0}
          />
        );
      })}
    </Group>
  );
};
