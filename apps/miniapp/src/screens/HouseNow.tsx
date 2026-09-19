import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import { formatDeadline, formatDue, type DomovoyApi, type HouseNowView } from '../api.js';
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

/** Та же строка, когда перечислять нечего: авария, о которой человек сам сообщил, стоит в его заявках. */
const MOOD_ALONE: Record<HouseNowView['mood'], string> = {
  sleeping: 'В доме спокойно',
  walking: 'Есть просрочка по вашим заявкам',
  alarmed: 'Авария в доме: она в ваших заявках',
};

/** Что в доме прямо сейчас. */
export const HouseNow = ({ api, onOpen }: HouseNowProps) => {
  const state = useBridgeRequest((alive) => api.until(alive).houseNow(), [api]);
  const incidents = state.data?.incidents ?? [];
  const works = state.data?.works ?? [];
  const mood = state.data?.mood;

  if (!mood) return null;

  const quiet = incidents.length === 0 && works.length === 0;

  return (
    <div data-guide="mood">
      {/* Настроение дома называет либо строка, либо список под ней: вдвоём они
          говорят одно и то же. */}
      {quiet ? (
        <p className={`mood mood-${mood}`}>
          <Domovoy mood={mood} size={44} />
          {MOOD_ALONE[mood]}
        </p>
      ) : (
        <Group title={MOOD[mood]} className={`house-now house-now-${mood}`}>
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
              subtitle={`${item.audience} · до ${formatDue(item.until)}`}
              separator={index > 0 || incidents.length > 0}
            />
          ))}
        </Group>
      )}
    </div>
  );
};
