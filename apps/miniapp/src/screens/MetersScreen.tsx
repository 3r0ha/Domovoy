import { Button, CellAction, CellInput, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useEffect, useRef, useState } from 'react';

import {
  ApiError,
  decimal,
  formatDay,
  formatPublished,
  monthName,
  needsApartment,
  type DomovoyApi,
  type MeterView,
} from '../api.js';
import { ChargesCard } from './ChargesCard.js';
import { Empty } from './Empty.js';
import { Failure } from './Failure.js';
import { usePhotos } from '../use-photos.js';
import { ErrorText } from './ErrorText.js';
import { IconMeters } from './icons.js';
import { PhotoField } from './PhotoField.js';
import { Skeleton } from './Skeleton.js';

export interface MetersScreenProps {
  api: DomovoyApi;
  /** Окно подачи показаний числами месяца: приходит с профилем. */
  readingWindow?: { fromDay: number; toDay: number } | undefined;
  /** Есть ли чем прочитать показание с фотографии табло. */
  photoSupported?: boolean;
  /** Подключён ли платёжный шлюз: без него квитанцию только показывают. */
  payable?: boolean;
  /** Платёжный шлюз модельный: об этом говорит строка под кнопкой. */
  paymentsModel?: boolean;
  /** Куда идти, если квартира ещё не привязана: счётчики принадлежат ей. */
  onBind?: () => void;
}

/** Месяц и срок подачи. */
const describePeriod = (
  done: boolean,
  at: Date,
  window: { fromDay: number; toDay: number } | undefined,
): string => {
  const month = monthName(at.getMonth());

  if (done) return `Показания за ${month} поданы`;

  return window ? `Показания за ${month} · до ${window.toDay} числа` : `Показания за ${month}`;
};

/** Сколько месяцев прошло с последнего показания. */
const monthsSince = (at: string | undefined, now: Date): number => {
  if (!at) return Number.POSITIVE_INFINITY;

  const was = new Date(at);

  return (now.getFullYear() - was.getFullYear()) * 12 + (now.getMonth() - was.getMonth());
};

/** Сколько месяцев считают по среднему, прежде чем перейти на норматив. */
const AVERAGE_MONTHS = 3;

/** Чем считается счёт, пока показаний нет. */
const silence = (meter: MeterView, now: Date): string | null => {
  if (meter.submittedThisMonth) return null;

  const months = monthsSince(meter.lastAt, now);

  if (months <= 1) return null;

  return months > AVERAGE_MONTHS
    ? 'Показаний нет, начисляем по нормативу'
    : 'Показаний нет, начисляем по среднему';
};

/** Расход по месяцам столбиками. */
const History = ({ api, meter, version }: { api: DomovoyApi; meter: MeterView; version: number }) => {
  const history = useBridgeRequest(() => api.meterHistory(meter.id), [api, meter.id, version]);
  const periods = (history.data ?? []).filter((period) => period.consumption > 0);

  if (periods.length < 2) return null;

  const max = Math.max(...periods.map((period) => period.consumption));
  const describe = (period: (typeof periods)[number]): string =>
    `${monthName(new Date(period.at).getMonth())} ${decimal(period.consumption)} ${meter.unit}`;

  return (
    <div className="spark" role="img" aria-label={`Расход по месяцам: ${periods.map(describe).join(', ')}`}>
      {periods.map((period, index) => (
        <span
          key={period.at}
          className={index === periods.length - 1 ? 'spark-bar spark-bar-now' : 'spark-bar'}
          style={{ height: `${Math.max(12, Math.round((period.consumption / max) * 100))}%` }}
          title={describe(period)}
        />
      ))}
    </div>
  );
};

/** Прошлое показание рядом с полем ввода. */
const MeterCard = ({
  api,
  meter,
  photoSupported,
  version,
  onSubmitted,
}: {
  api: DomovoyApi;
  meter: MeterView;
  photoSupported?: boolean;
  version: number;
  onSubmitted: () => void;
}) => {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ consumption: number; spike: boolean; advice?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const photo = usePhotos(api);

  const snapshot = photo.photos.at(-1)?.token;
  const forget = useRef(photo.reset);

  forget.current = photo.reset;

  // Зависимость по снимку, а не по всему набору: иначе разбор уходил бы на каждый рендер.
  useEffect(() => {
    if (!snapshot) return undefined;

    let active = true;

    forget.current();

    void api
      .readMeterPhoto(meter.id, snapshot)
      .then((read) => {
        if (!active) return;

        if (read.value === undefined) setError('С фотографии не разобрали, введите цифрами');
        else setValue(String(read.value));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof ApiError ? reason.message : 'Не удалось разобрать фотографию');
      });

    return () => {
      active = false;
    };
  }, [snapshot, api, meter.id]);

  const submit = async (): Promise<void> => {
    const parsed = Number(value.replace(',', '.'));

    if (!Number.isFinite(parsed)) {
      setError('Отправьте показание цифрами');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const submitted = await api.submitReading(meter.id, parsed);

      setResult({
        consumption: submitted.consumption,
        spike: submitted.spike,
        ...(submitted.advice ? { advice: submitted.advice } : {}),
      });
      setValue('');
      setEditing(false);
      onSubmitted();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Показание не принято');
    } finally {
      setSending(false);
    }
  };

  const sent = meter.submittedThisMonth && !editing;
  const expired = meter.verification === 'expired';
  const silent = silence(meter, new Date());
  const was =
    meter.lastValue === undefined
      ? `Показаний ещё не было · ${meter.serial}`
      : `${decimal(meter.lastValue)} ${meter.unit}${meter.lastAt ? ` · ${formatPublished(meter.lastAt)}` : ''}`;

  return (
    <CellList mode="island">
      <CellSimple
        className="meter-row"
        title={meter.title}
        subtitle={sent ? was : meter.lastValue === undefined ? was : `Было ${was}`}
        after={
          expired ? (
            <span className="row-state">
              <span className="dot dot-bad" />
              нужна поверка
            </span>
          ) : (
            <span className="row-state">
              <span className={meter.submittedThisMonth ? 'dot dot-good' : 'dot dot-muted'} />
              {meter.submittedThisMonth ? 'подано' : 'ждём'}
            </span>
          )
        }
        {...(sent && !expired
          ? {
              showChevron: true,
              onClick: () => {
                setValue(String(meter.lastValue ?? ''));
                setEditing(true);
              },
            }
          : {})}
      />

      {expired ? (
        <p className="hint inset">
          {meter.verifiedUntil ? `Поверка истекла ${formatDay(meter.verifiedUntil)}. ` : ''}
          До новой поверки начисляют по нормативу
        </p>
      ) : null}

      {meter.verification === 'soon' && meter.verifiedUntil ? (
        <p className="hint inset">Поверка до {formatDay(meter.verifiedUntil)}</p>
      ) : null}

      {silent && !expired ? <p className="hint inset">{silent}</p> : null}

      <History api={api} meter={meter} version={version} />

      {sent || expired ? null : (
        <>
          <CellInput
            className="field-row"
            type="text"
            inputMode="decimal"
            aria-label={`Показание: ${meter.title}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            placeholder={`Показание, ${meter.unit}`}
          />

          {value.trim().length > 0 || sending ? (
            <CellAction className="reading-send" mode="primary" disabled={sending} onClick={() => void submit()}>
              {sending ? 'Отправляем…' : 'Подать'}
            </CellAction>
          ) : photoSupported ? (
            <div className="reading-photo">
              <PhotoField
                label="Снять табло"
                count={0}
                uploading={photo.uploading}
                error={photo.error}
                withLabel
                onPick={photo.attach}
              />
            </div>
          ) : null}
        </>
      )}

      {error ? <ErrorText className="inset">{error}</ErrorText> : null}

      {result ? (
        <p className={result.spike ? 'error inset' : 'hint inset'} role="status">
          {/* Расход считается от прошлого показания: у первого сравнивать не с чем. */}
          Принято
          {meter.lastValue === undefined ? '' : ` · расход ${decimal(result.consumption)} ${meter.unit}`}
          {result.spike ? ' · больше обычного' : ''}
        </p>
      ) : null}

      {result?.advice ? <p className="hint inset">{result.advice}</p> : null}
    </CellList>
  );
};

/** Показания подают раз в месяц по всем приборам сразу. */
/**
 * Сколько квартир дома уже подали показания. Имён в полосе нет.
 */
const Together = ({ api, version }: { api: DomovoyApi; version: number }) => {
  const progress = useBridgeRequest(() => api.readingProgress(), [api, version]);
  const total = progress.data?.total ?? 0;
  const submitted = progress.data?.submitted ?? 0;

  if (total < 2) return null;

  const left = total - submitted;

  return (
    <p className="together">
      <span className="together-bar">
        <span style={{ width: `${Math.round((submitted / total) * 100)}%` }} />
      </span>
      {left === 0 ? 'Дом передал показания' : `Осталось ${left} из ${total}`}
    </p>
  );
};

export const MetersScreen = ({ api, readingWindow, photoSupported, payable, paymentsModel, onBind }: MetersScreenProps) => {
  const meters = useBridgeRequest(() => api.meters(), [api]);
  const [submitted, setSubmitted] = useState(0);

  if (meters.loading && !meters.data) return <Skeleton count={3} />;

  if (meters.error) {
    return (
      <Failure title="Счётчики недоступны" error={meters.error} onRetry={meters.reload}>
        {onBind && needsApartment(meters.error) ? (
          <Button type="button" onClick={onBind}>
            Привязать квартиру
          </Button>
        ) : null}
      </Failure>
    );
  }

  if (meters.data?.length === 0) {
    return (
      <Empty
        icon={<IconMeters />}
        title="Счётчиков нет"
        hint="За квартирой не числятся приборы учёта"
      />
    );
  }

  const done = meters.data?.every((meter) => meter.submittedThisMonth) ?? false;

  return (
    <section className="list">
      <ChargesCard api={api} version={submitted} payable={payable !== false} model={paymentsModel} />

      <p className="group-title">{describePeriod(done, new Date(), readingWindow)}</p>

      <Together api={api} version={submitted} />

      {meters.data?.map((meter) => (
        <MeterCard
          key={meter.id}
          api={api}
          meter={meter}
          {...(photoSupported ? { photoSupported } : {})}
          version={submitted}
          onSubmitted={() => {
            meters.reload();
            setSubmitted((version) => version + 1);
          }}
        />
      ))}
    </section>
  );
};
