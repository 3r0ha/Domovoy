import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import type { Translate } from '@domovoy/i18n';

import { formatDue, formatLeft, type DomovoyApi, type HouseNowView } from '../api.js';
import { useT } from '../i18n.js';
import { Domovoy } from './Domovoy.js';
import { Group } from './Group.js';
import { noted } from './MachineNote.js';
import { IconNews, IconWarning } from './icons.js';

export interface HouseNowProps {
  api: DomovoyApi;
  /** Открыть аварию, о которой уже сообщили. */
  onOpen: (id: string) => void;
}

const moodTitle = (t: Translate, kind: HouseNowView['mood']): string =>
  ({
    sleeping: t('home.mood.sleeping'),
    walking: t('home.mood.walking'),
    alarmed: t('home.mood.alarmed'),
  })[kind];

/** Та же строка, когда перечислять нечего: авария, о которой человек сам сообщил, стоит в его заявках. */
const moodAlone = (t: Translate, kind: HouseNowView['mood']): string =>
  ({
    sleeping: t('home.mood.alone.sleeping'),
    walking: t('home.mood.alone.walking'),
    alarmed: t('home.mood.alone.alarmed'),
  })[kind];

/** Что в доме прямо сейчас. */
export const HouseNow = ({ api, onOpen }: HouseNowProps) => {
  const t = useT();
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
          {moodAlone(t, mood)}
        </p>
      ) : (
        <Group title={moodTitle(t, mood)} className={`house-now house-now-${mood}`}>
          {incidents.map((item, index) => (
            <CellSimple
              key={item.id}
              before={
                <span className="tile tile-red">
                  <IconWarning />
                </span>
              }
              title={item.title}
              // Срок называется так же, как в списке заявок под этим блоком:
              // «осталось 6 ч» над «5 ч» читалось как две разные величины.
              subtitle={`${item.target} · ${formatLeft(item.resolutionDueAt)}${noted(t, item.machineTranslated)}`}
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
              subtitle={
                t('home.works.until', { кому: item.audience, срок: formatDue(item.until) }) +
                noted(t, item.machineTranslated)
              }
              separator={index > 0 || incidents.length > 0}
            />
          ))}
        </Group>
      )}
    </div>
  );
};
