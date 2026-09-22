import { Button, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import { formatDayAt, formatLeft, tight, type DomovoyApi } from '../api.js';
import { useT } from '../i18n.js';
import { Empty } from './Empty.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconCalendar } from './icons.js';
import { Skeleton } from './Skeleton.js';

/**
 * Рабочий день исполнителя. Наряды приходили по одному сообщением, а дня
 * целиком мастер не видел: сколько объектов на нём, где его ждут ко времени
 * и в каком порядке идти.
 */
export const WorkdayScreen = ({
  api,
  onOpen,
  onOrders,
}: {
  api: DomovoyApi;
  onOpen: (id: string) => void;
  /** Уйти в список нарядов: на сегодня их может не быть, а на мастере быть. */
  onOrders?: () => void;
}) => {
  const t = useT();
  const day = useBridgeRequest((alive) => api.until(alive).workday(), [api]);

  if (day.error && !day.data) {
    return <Failure title={t('day.title')} error={day.error} onRetry={day.reload} />;
  }

  if (!day.data) return <Skeleton count={4} />;

  // Пусто здесь означает «на сегодня», а не «нарядов нет»: соседняя вкладка
  // в этот же момент показывает пять, и без выхода к ней экран врёт.
  if (day.data.items.length === 0) {
    return (
      <Empty icon={<IconCalendar />} title={t('day.empty')}>
        {onOrders ? (
          <Button type="button" size="large" onClick={onOrders}>
            {t('day.toOrders')}
          </Button>
        ) : null}
      </Empty>
    );
  }

  return (
    <>
      {day.data.appointed > 0 || day.data.overdue > 0 ? (
        <p className="hint aside">
          {[
            day.data.appointed > 0 ? t('day.appointed', { сколько: day.data.appointed }) : '',
            day.data.overdue > 0 ? t('day.overdue', { сколько: day.data.overdue }) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}

      <Group title={t('day.order')}>
        {day.data.items.map((item, index) => (
          <CellSimple
            key={item.requestId}
            className="row-split"
            title={item.title}
            // Время встречи и остаток срока это разные числа: без подписи мастер
            // читает «5 ч» и «11:00» как одно и то же.
            subtitle={
              item.visitAt
                ? `${tight(item.place)} · ${t('day.visitAt', { когда: formatDayAt(item.visitAt) })}`
                : `${tight(item.place)} · ${item.number}`
            }
            after={
              item.visitAt ? null : (
                <span className={item.overdue ? 'row-due overdue' : 'row-due'}>{formatLeft(item.dueAt)}</span>
              )
            }
            separator={index > 0}
            showChevron
            onClick={() => onOpen(item.requestId)}
          />
        ))}
      </Group>

      {day.data.items.some((item) => (item.materials ?? []).length > 0) ? (
        <p className="hint aside">
          {t('day.materials', {
            что: day.data.items
              .flatMap((item) => item.materials ?? [])
              .map((material) => `${material.title} ${material.count}${material.unit ? ` ${material.unit}` : ''}`)
              .join(', '),
          })}
        </p>
      ) : null}
    </>
  );
};
