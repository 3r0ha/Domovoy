import { Button, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useEffect } from 'react';

import { formatDay, monthName, monthShort, plural, type DomovoyApi } from '../api.js';
import { DoorRow } from './DoorRow.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconRequests } from './icons.js';
import { RequestRow } from './RequestRow.js';
import { Skeleton } from './Skeleton.js';

export interface ObjectScreenProps {
  api: DomovoyApi;
  /** Код с наклейки: он и определяет, о каком объекте речь. */
  startParam: string;
  /** Название объекта для шапки: его присылает сервер, а уход с экрана его снимает. */
  onTitle?: (title: string | null) => void;
  /** Сообщить о проблеме по этому объекту. */
  onReport: () => void;
  onOpenRequest: (id: string) => void;
}

/** Сколько раз объект уже ломался: подпись под списком. */
export const objectHistory = (total: number, lastRepairAt?: string, averageDays?: number): string =>
  [
    plural(total, 'обращение', 'обращения', 'обращений'),
    lastRepairAt ? `ремонт ${formatDay(lastRepairAt)}` : '',
    averageDays === undefined ? '' : `раз в ${plural(averageDays, 'день', 'дня', 'дней')}`,
  ]
    .filter(Boolean)
    .join(' · ');

const MONTHS = 12;

/** Поломки по месяцам за последний год. Индекс 11 это текущий месяц. */
export const failuresByMonth = (history: readonly { createdAt: string }[], now: Date): number[] => {
  const counts = new Array<number>(MONTHS).fill(0);
  const base = now.getFullYear() * 12 + now.getMonth();

  for (const item of history) {
    const at = new Date(item.createdAt);
    const index = MONTHS - 1 - (base - (at.getFullYear() * 12 + at.getMonth()));

    if (index >= 0 && index < MONTHS) counts[index]! += 1;
  }

  return counts;
};

/** Номер месяца столбика: нулевой это год назад, последний текущий. */
const columnIndex = (index: number, now: Date): number =>
  new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - index), 1).getMonth();

/** Месяц столбика словом. */
const columnMonth = (index: number, now: Date): string => monthName(columnIndex(index, now));

/** Год объекта: поломки по месяцам. Столбик и его подпись стоят одной колонкой. */
const Year = ({ history }: { history: readonly { createdAt: string }[] }) => {
  const now = new Date();
  const months = failuresByMonth(history, now);

  return (
    <>
      <p className="hint year-title">Поломки по месяцам</p>

      <div className="year" aria-label="Поломки по месяцам за год">
        {months.map((count, index) => (
          <span
            key={index}
            className={index === MONTHS - 1 ? 'month-column month-now' : 'month-column'}
            title={`${columnMonth(index, now)}: ${plural(count, 'поломка', 'поломки', 'поломок')}`}
          >
            <span className={count === 0 ? 'month' : count === 1 ? 'month month-once' : 'month month-often'} />
            <span className="month-name">{monthShort(columnIndex(index, now))}</span>
          </span>
        ))}
      </div>
    </>
  );
};

/** Объект с наклейки: его оборудование, открытые заявки и история. */
export const ObjectScreen = ({ api, startParam, onTitle, onReport, onOpenRequest }: ObjectScreenProps) => {
  const passport = useBridgeRequest(() => api.objectPassport(startParam), [api, startParam]);
  const target = passport.data?.target;

  // Название уходит в шапку отдельно от загрузки и снимается при уходе с экрана.
  useEffect(() => {
    if (!target) return undefined;

    onTitle?.(target);

    return () => onTitle?.(null);
  }, [target, onTitle]);

  if (passport.loading && !passport.data) return <Skeleton count={2} />;

  if (passport.error || !passport.data) {
    return (
      <Failure title="Объект не найден" error={passport.error} onRetry={passport.reload}>
        <Button type="button" variant="secondary" onClick={onReport}>
          Оставить заявку
        </Button>
      </Failure>
    );
  }

  const object = passport.data;
  const door = (object.devices ?? []).find((device) => device.kind !== 'camera');

  return (
    <div className="list">
      {door ? (
        <CellList mode="island">
          <DoorRow api={api} device={door} separator={false} />
        </CellList>
      ) : null}

      {object.open.length > 0 ? (
        <Group title="Об этом уже сообщили">
          {object.open.map((request, index) => (
            <RequestRow
              key={request.id}
              request={request}
              separator={index > 0}
              onOpen={() => onOpenRequest(request.id)}
            />
          ))}
        </Group>
      ) : null}

      <CellList mode="island">
        <CellSimple
          before={
            <span className="tile tile-blue">
              <IconRequests />
            </span>
          }
          title="Сообщить о поломке"
          showChevron
          onClick={onReport}
        />
      </CellList>

      {object.totalRequests > 0 ? (
        <>
          <p className="hint aside">{objectHistory(object.totalRequests, object.lastRepairAt, object.averageDays)}</p>

          {/* Частота поломок это наблюдение продукта, а не регламент обслуживания. */}
          {object.averageDays === undefined ? null : (
            <p className="hint aside">Это прогноз по прошлым поломкам, а не регламент</p>
          )}
        </>
      ) : null}

      {object.totalRequests > 1 ? <Year history={object.history} /> : null}
    </div>
  );
};
