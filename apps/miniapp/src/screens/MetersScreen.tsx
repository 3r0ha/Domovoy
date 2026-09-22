import { Button, CellAction, CellInput, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useEffect, useRef, useState } from 'react';

import type { Translate } from '@domovoy/i18n';

import {
  ApiError,
  decimal,
  formatDay,
  formatPublished,
  monthName,
  needsApartment,
  parseDecimal,
  type DomovoyApi,
  type MeterView,
} from '../api.js';
import { useT } from '../i18n.js';
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
  /** Куда писать, если счётчики есть, а в продукте их нет. */
  onSupport?: () => void;
}

/** Месяц и срок подачи. */
const describePeriod = (
  t: Translate,
  done: boolean,
  at: Date,
  window: { fromDay: number; toDay: number } | undefined,
): string => {
  const month = monthName(at.getMonth());

  if (done) return t('meters.period.done', { месяц: month });

  return window
    ? t('meters.period.due', { месяц: month, день: window.toDay })
    : t('meters.period', { месяц: month });
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
const silence = (t: Translate, meter: MeterView, now: Date): string | null => {
  if (meter.submittedThisMonth) return null;

  const months = monthsSince(meter.lastAt, now);

  if (months <= 1) return null;

  return months > AVERAGE_MONTHS ? t('meters.silence.norm') : t('meters.silence.average');
};

/** Расход по месяцам столбиками. */
const History = ({ api, meter, version }: { api: DomovoyApi; meter: MeterView; version: number }) => {
  const t = useT();
  const history = useBridgeRequest((alive) => api.until(alive).meterHistory(meter.id), [api, meter.id, version]);
  const periods = (history.data ?? []).filter((period) => period.consumption > 0);

  if (periods.length < 2) return null;

  const max = Math.max(...periods.map((period) => period.consumption));
  const describe = (period: (typeof periods)[number]): string =>
    `${monthName(new Date(period.at).getMonth())} ${decimal(period.consumption)} ${meter.unit}`;

  return (
    <div
      className="spark"
      role="img"
      aria-label={t('meters.history.label', { список: periods.map(describe).join(', ') })}
    >
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
  explain,
  version,
  onSubmitted,
}: {
  api: DomovoyApi;
  meter: MeterView;
  photoSupported?: boolean;
  /** Что вводить, объясняется один раз на экран, а не под каждым счётчиком. */
  explain?: boolean;
  version: number;
  onSubmitted: () => void;
}) => {
  const t = useT();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ consumption: number; spike: boolean; advice?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(false);
  const photo = usePhotos(api);

  const snapshot = photo.photos.at(-1)?.token;
  const forget = useRef(photo.reset);

  forget.current = photo.reset;

  // Зависимость по снимку, а не по всему набору: иначе разбор уходил бы на каждый рендер.
  useEffect(() => {
    if (!snapshot) return undefined;

    let active = true;

    setError(null);
    setReading(true);

    // Распознанное число встаёт в поле, а не подаётся: человек сверяет его с табло.
    // Снимок забывается после ответа, а не до него: сброс меняет зависимость
    // и снимает ожидание, и ответ пропадал бы вместе с ним.
    void api
      .readMeterPhoto(meter.id, snapshot)
      .then((read) => {
        if (!active) return;

        if (read.value === undefined) {
          setError(t('meters.photo.unreadable'));
        } else {
          setValue(String(read.value));
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof ApiError ? reason.message : t('meters.photo.failed'));
      })
      .finally(() => {
        if (!active) return;

        setReading(false);
        forget.current();
      });

    return () => {
      active = false;
    };
  }, [snapshot, api, meter.id, t]);

  const submit = async (): Promise<void> => {
    // Повтор по Enter, пока показание ещё летит, подал бы его дважды.
    if (sending) return;

    const parsed = parseDecimal(value);

    if (parsed === null) {
      setError(t('meters.input.digits'));
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
      setError(reason instanceof ApiError ? reason.message : t('meters.submit.failed'));
    } finally {
      setSending(false);
    }
  };

  const sent = meter.submittedThisMonth && !editing;
  const expired = meter.verification === 'expired';
  const silent = silence(t, meter, new Date());
  const was =
    meter.lastValue === undefined
      ? t('meters.last.never', { номер: meter.serial })
      : `${decimal(meter.lastValue)} ${meter.unit}${meter.lastAt ? ` · ${formatPublished(meter.lastAt)}` : ''}`;

  return (
    <CellList mode="island">
      <CellSimple
        className="meter-row"
        title={meter.title}
        subtitle={sent ? was : meter.lastValue === undefined ? was : t('meters.last.was', { показание: was })}
        after={
          expired ? (
            <span className="row-state">
              <span className="dot dot-bad" />
              {t('meters.verification.state')}
            </span>
          ) : (
            <span className="row-state">
              <span className={meter.submittedThisMonth ? 'dot dot-good' : 'dot dot-muted'} />
              {meter.submittedThisMonth ? t('meters.state.sent') : t('meters.state.waiting')}
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
          {meter.verifiedUntil ? t('meters.verification.expiredAt', { дата: formatDay(meter.verifiedUntil) }) : ''}
          {t('meters.verification.hint')}
        </p>
      ) : null}

      {meter.verification === 'soon' && meter.verifiedUntil ? (
        <p className="hint inset">{t('meters.verification.soon', { дата: formatDay(meter.verifiedUntil) })}</p>
      ) : null}

      {silent && !expired ? <p className="hint inset">{silent}</p> : null}

      <History api={api} meter={meter} version={version} />

      {sent || expired ? null : (
        <>
          {/* Подпись видимая, а не только для голосового помощника: по одному
              полю человек не понимает, какие именно цифры от него ждут. Но
              под каждым счётчиком это была стена из трёх одинаковых абзацев. */}
          {explain ? <p className="hint inset">{t('meters.input.hint')}</p> : null}

          <CellInput
            className="field-row"
            type="text"
            inputMode="decimal"
            aria-label={t('meters.input.label', { счётчик: meter.title })}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !sending) void submit();
            }}
            placeholder={t('meters.input.placeholder', { единица: meter.unit })}
          />

          {value.trim().length > 0 || sending ? (
            <CellAction className="reading-send" mode="primary" disabled={sending} onClick={() => void submit()}>
              {sending ? t('meters.submit.sending') : t('meters.submit.action')}
            </CellAction>
          ) : reading ? (
            <p className="hint inset reading-wait" role="status">
              {t('meters.photo.reading')}
            </p>
          ) : photoSupported ? (
            <div className="reading-photo">
              <PhotoField
                label={t('meters.photo.take')}
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
          {t('meters.result.accepted')}
          {meter.lastValue === undefined
            ? ''
            : t('meters.result.consumption', { расход: decimal(result.consumption), единица: meter.unit })}
          {result.spike ? t('meters.result.spike') : ''}
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
  const t = useT();
  const progress = useBridgeRequest((alive) => api.until(alive).readingProgress(), [api, version]);
  const total = progress.data?.total ?? 0;
  const submitted = progress.data?.submitted ?? 0;

  // Полоса нужна, только когда подталкивает: «не передали 12 из 12» жильцу
  // ничего не сообщает, а пустая шкала читается как сломанный элемент.
  if (total < 2 || submitted === 0) return null;

  const left = total - submitted;

  return (
    <p className="together">
      <span className="together-bar">
        <span style={{ width: `${Math.round((submitted / total) * 100)}%` }} />
      </span>
      {left === 0 ? t('meters.together.done') : t('meters.together.left', { осталось: left, всего: total })}
    </p>
  );
};

export const MetersScreen = ({
  api,
  readingWindow,
  photoSupported,
  payable,
  paymentsModel,
  onBind,
  onSupport,
}: MetersScreenProps) => {
  const t = useT();
  const meters = useBridgeRequest((alive) => api.until(alive).meters(), [api]);
  const [submitted, setSubmitted] = useState(0);

  if (meters.loading && !meters.data) return <Skeleton count={3} />;

  if (meters.error) {
    return (
      <Failure title={t('meters.failure')} error={meters.error} onRetry={meters.reload}>
        {onBind && needsApartment(meters.error) ? (
          <Button type="button" onClick={onBind}>
            {t('meters.bind')}
          </Button>
        ) : null}
      </Failure>
    );
  }

  if (meters.data?.length === 0) {
    return (
      <Empty icon={<IconMeters />} title={t('meters.empty')} hint={t('meters.empty.hint')}>
        <Button type="button" onClick={onSupport}>
          {t('meters.support')}
        </Button>
      </Empty>
    );
  }

  const done = meters.data?.every((meter) => meter.submittedThisMonth) ?? false;

  return (
    <section className="list">
      <ChargesCard api={api} version={submitted} payable={payable !== false} model={paymentsModel} />

      <p className="group-title">{describePeriod(t, done, new Date(), readingWindow)}</p>

      <Together api={api} version={submitted} />

      {meters.data?.map((meter, index) => (
        <MeterCard
          key={meter.id}
          api={api}
          meter={meter}
          {...(photoSupported ? { photoSupported } : {})}
          {...(index === 0 ? { explain: true } : {})}
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
