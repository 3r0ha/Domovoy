import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { Fragment } from 'react';

import { formatDeadline, formatTime, type DomovoyApi, type HouseNowView } from '../api.js';
import { Domovoy } from './Domovoy.js';
import { Group } from './Group.js';
import { IconNews, IconWarning } from './icons.js';

export interface HouseNowProps {
  api: DomovoyApi;
  /** Открыть аварию, о которой уже сообщили. */
  onOpen: (id: string) => void;
}

const MOOD: Record<HouseNowView['mood'], string> = {
  sleeping: 'В доме спокойно',
  walking: 'Есть просрочка',
  alarmed: 'Авария в доме',
};

/** Что в доме прямо сейчас. */
export const HouseNow = ({ api, onOpen }: HouseNowProps) => {
  const state = useBridgeRequest(() => api.houseNow(), [api]);
  const incidents = state.data?.incidents ?? [];
  const works = state.data?.works ?? [];
  const mood = state.data?.mood;

  if (!mood) return null;

  return (
    <Fragment>
      <p className={`mood mood-${mood}`} data-guide="mood">
        <Domovoy mood={mood} size={44} />
        {MOOD[mood]}
      </p>

      {incidents.length === 0 && works.length === 0 ? null : (
        <Group title="Сейчас в доме">
          {incidents.map((item, index) => (
            <CellSimple
              key={item.id}
              before={
                <span className="tile tile-red">
                  <IconWarning />
                </span>
              }
              title={item.title}
              subtitle={`${item.target} · ${formatDeadline(item.resolutionDueAt)}`}
              showChevron
              separator={index > 0}
              onClick={() => onOpen(item.id)}
            />
          ))}

          {works.map((item, index) => (
            <CellSimple
              key={`${item.title}-${item.until}`}
              before={
                <span className="tile tile-orange">
                  <IconNews />
                </span>
              }
              title={item.title}
              subtitle={`${item.audience} · до ${formatTime(item.until)}`}
              separator={index > 0 || incidents.length > 0}
            />
          ))}
        </Group>
      )}
    </Fragment>
  );
};
