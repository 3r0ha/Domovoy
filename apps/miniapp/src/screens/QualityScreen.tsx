import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import type { Translate } from '@domovoy/i18n';

import { counted, type DomovoyApi, type QualityView } from '../api.js';
import { useT } from '../i18n.js';
import { Amount } from './Amount.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { Skeleton } from './Skeleton.js';

export interface QualityScreenProps {
  api: DomovoyApi;
}

const hours = (value: number): string =>
  value < 24 ? counted('count.hour', Math.round(value)) : counted('count.day', Math.round(value / 24));

interface Line {
  title: string;
  value: string;
  /**
   * Единица рядом с числом. Задаётся только там, где она не часть языка:
   * знак процента один на все языки, а «часа» и «из 5» склоняются вместе
   * с числом и остаются внутри перевода.
   */
  unit?: string;
  /** На месте числа слово: весом числа оно читалось как главное в столбце. */
  plain?: boolean;
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
      value: String(Math.round(quality.inTimeRate * 100)),
      unit: '%',
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
      ? { title: t('quality.rating'), value: t('quality.rating.none'), plain: true }
      : {
          title: t('quality.rating'),
          value: t('quality.rating.value', { оценка: quality.averageRating }),
          hint: t('quality.rated', { заявки: counted('count.rated', quality.rated) }),
        },
  );

  return own;
};

/** Как работает управляющая организация в доме жильца. */
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
      : t('quality.period', { дни: counted('count.day', data.days) });

  return (
    <div className="list">
      {/* Числа считаются по дому квартиры, а он не всегда тот, который человек ведёт. */}
      {data.address ? <p className="hint aside">{data.address}</p> : null}

      <Group title={t('quality.now')}>
        <CellSimple
          title={t('quality.open')}
          after={<Amount value={data.open} />}
          height="compact"
        />
        <CellSimple
          title={t('quality.overdue')}
          after={<Amount value={data.overdue} {...(data.overdue > 0 ? { className: 'overdue' } : {})} />}
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
            after={
              <Amount
                value={line.value}
                {...(line.unit ? { unit: line.unit } : {})}
                {...(line.plain ? { plain: line.plain } : {})}
              />
            }
            separator={index > 0}
            height="compact"
          />
        ))}
      </Group>
    </div>
  );
};
