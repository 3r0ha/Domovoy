import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import type { Translate } from '@domovoy/i18n';

import { plural, type DomovoyApi, type QualityView } from '../api.js';
import { useT } from '../i18n.js';
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
const lines = (t: Translate, quality: QualityView): Line[] => {
  const own: Line[] = [
    { title: t('quality.created'), value: String(quality.created) },
    { title: t('quality.closed'), value: String(quality.closed) },
  ];

  if (quality.inTimeRate !== undefined) {
    const was = quality.before?.inTimeRate;

    own.push({
      title: t('quality.inTime'),
      value: `${Math.round(quality.inTimeRate * 100)}%`,
      ...(was === undefined ? {} : { hint: t('quality.before', { было: `${Math.round(was * 100)}%` }) }),
    });
  }

  if (quality.averageHours !== undefined) {
    const was = quality.before?.averageHours;

    own.push({
      title: t('quality.average'),
      value: hours(quality.averageHours),
      ...(was === undefined || was === 0 ? {} : { hint: t('quality.before', { было: hours(was) }) }),
    });
  }

  own.push(
    quality.averageRating === undefined
      ? { title: t('quality.rating'), value: t('quality.rating.none') }
      : {
          title: t('quality.rating'),
          value: t('quality.rating.value', { оценка: quality.averageRating }),
          hint: t('quality.rated', { заявки: plural(quality.rated, 'заявку', 'заявки', 'заявок') }),
        },
  );

  return own;
};

/** Как работает управляющая компания в доме жильца. */
export const QualityScreen = ({ api }: QualityScreenProps) => {
  const t = useT();
  const quality = useBridgeRequest((alive) => api.until(alive).quality(), [api]);

  if (quality.loading && !quality.data) return <Skeleton count={2} />;

  if (quality.error || !quality.data) {
    return <Failure title={t('quality.failed')} error={quality.error} onRetry={quality.reload} />;
  }

  const data = quality.data;
  const period =
    data.days === undefined
      ? t('quality.period.any')
      : t('quality.period', { дни: plural(data.days, 'день', 'дня', 'дней') });

  return (
    <div className="list">
      {/* Числа считаются по дому квартиры, а он не всегда тот, который человек ведёт. */}
      {data.address ? <p className="hint aside">{data.address}</p> : null}

      <Group title={t('quality.now')}>
        <CellSimple
          title={t('quality.open')}
          after={<span className="report-value">{data.open}</span>}
          height="compact"
        />
        <CellSimple
          title={t('quality.overdue')}
          after={
            <span className={data.overdue > 0 ? 'report-value overdue' : 'report-value'}>{data.overdue}</span>
          }
          separator
          height="compact"
        />
      </Group>

      <Group title={period}>
        {lines(t, data).map((line, index) => (
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
