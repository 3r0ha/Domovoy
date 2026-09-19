import { CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import { formatDay, plural, type DomovoyApi, type EquipmentHealthView } from '../api.js';
import { Empty } from './Empty.js';
import { Failure } from './Failure.js';
import { IconWrench } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface EquipmentScreenProps {
  api: DomovoyApi;
  /** Открыть карточку объекта: там его история и открытые заявки. */
  onOpen: (startParam: string) => void;
}

/** Что известно про эту единицу: строка под названием. */
const summary = (item: EquipmentHealthView): string => {
  if (item.failures === 0) return 'поломок не было';

  return `${plural(item.failures, 'поломка', 'поломки', 'поломок')}${
    item.lastAt ? ` · последняя ${formatDay(item.lastAt)}` : ''
  }`;
};

/** Когда ждать следующей поломки по истории объекта. */
const forecast = (item: EquipmentHealthView): { text: string; tone: string } | null => {
  if (item.broken) return { text: 'есть заявка', tone: 'due-broken' };
  if (item.dueInDays === undefined) return null;
  if (item.dueInDays < 0) return { text: 'пора смотреть', tone: 'due-soon' };
  if (item.dueInDays <= 7) return { text: `через ${plural(item.dueInDays, 'день', 'дня', 'дней')}`, tone: 'due-soon' };

  return { text: `через ${plural(item.dueInDays, 'день', 'дня', 'дней')}`, tone: '' };
};

/** Здоровье оборудования дома. */
export const EquipmentScreen = ({ api, onOpen }: EquipmentScreenProps) => {
  const health = useBridgeRequest((alive) => api.until(alive).equipment(), [api]);

  if (health.loading && !health.data) return <Skeleton count={3} />;

  if (health.error || !health.data) {
    return <Failure title="Оборудование не загрузилось" error={health.error} onRetry={health.reload} />;
  }

  const items = health.data;

  if (items.length === 0) {
    return <Empty icon={<IconWrench />} title="Оборудования нет" hint="Появится, когда заведут лифты и домофоны" />;
  }

  return (
    <CellList mode="island">
      {items.map((item, index) => {
        const due = forecast(item);

        return (
          <CellSimple
            key={item.code}
            title={item.title}
            subtitle={summary(item)}
            after={due ? <span className={`due ${due.tone}`}>{due.text}</span> : null}
            separator={index > 0}
            showChevron
            onClick={() => onOpen(item.startParam)}
          />
        );
      })}
    </CellList>
  );
};
