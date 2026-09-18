import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import { plural, type DomovoyApi, type QualityView } from '../api.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { Skeleton } from './Skeleton.js';

export interface QualityScreenProps {
  api: DomovoyApi;
}

const hours = (value: number): string =>
  value < 24
    ? plural(Math.round(value), 'час', 'часа', 'часов')
    : plural(Math.round(value / 24), 'день', 'дня', 'дней');

interface Line {
  title: string;
  value: string;
  hint?: string;
}

/** Числа те же, что в сводке компании. */
const lines = (quality: QualityView): Line[] => {
  const own: Line[] = [
    { title: 'Заявок подано', value: String(quality.created) },
    { title: 'Закрыто', value: String(quality.closed) },
  ];

  if (quality.inTimeRate !== undefined) {
    const was = quality.before?.inTimeRate;

    own.push({
      title: 'Уложились в срок',
      value: `${Math.round(quality.inTimeRate * 100)}%`,
      ...(was === undefined ? {} : { hint: `периодом раньше ${Math.round(was * 100)}%` }),
    });
  }

  if (quality.averageHours !== undefined) {
    const was = quality.before?.averageHours;

    own.push({
      title: 'Среднее время работы',
      value: hours(quality.averageHours),
      ...(was === undefined || was === 0 ? {} : { hint: `периодом раньше ${hours(was)}` }),
    });
  }

  own.push(
    quality.averageRating === undefined
      ? { title: 'Оценка жильцов', value: 'не оценивали' }
      : {
          title: 'Оценка жильцов',
          value: `${quality.averageRating} из 5`,
          hint: `оценили ${plural(quality.rated, 'заявку', 'заявки', 'заявок')}`,
        },
  );

  return own;
};

/** Как работает управляющая компания в доме жильца. */
export const QualityScreen = ({ api }: QualityScreenProps) => {
  const quality = useBridgeRequest(() => api.quality(), [api]);

  if (quality.loading && !quality.data) return <Skeleton count={2} />;

  if (quality.error || !quality.data) {
    return <Failure title="Работа дома недоступна" error={quality.error} onRetry={quality.reload} />;
  }

  const data = quality.data;
  const period = data.days === undefined ? 'За период' : `За ${plural(data.days, 'день', 'дня', 'дней')}`;

  return (
    <div className="list">
      {/* Числа считаются по дому квартиры, а он не всегда тот, который человек ведёт. */}
      {data.address ? <p className="hint aside">{data.address}</p> : null}

      <Group title="Сейчас в доме">
        <CellSimple
          title="Открытых заявок"
          after={<span className="report-value">{data.open}</span>}
          height="compact"
        />
        <CellSimple
          title="Просрочено"
          after={
            <span className={data.overdue > 0 ? 'report-value overdue' : 'report-value'}>{data.overdue}</span>
          }
          separator
          height="compact"
        />
      </Group>

      <Group title={period}>
        {lines(data).map((line, index) => (
          <CellSimple
            key={line.title}
            title={line.title}
            {...(line.hint ? { subtitle: line.hint } : {})}
            after={<span className="report-value">{line.value}</span>}
            separator={index > 0}
            height="compact"
          />
        ))}
      </Group>
    </div>
  );
};
