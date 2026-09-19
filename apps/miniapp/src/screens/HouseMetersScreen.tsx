import { CellAction, CellInput, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { ApiError, formatDay, formatPublished, parseDecimal, type DomovoyApi, type MeterView } from '../api.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { useToast } from '../toast.js';
import { IconMeters } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface HouseMetersScreenProps {
  api: DomovoyApi;
  /** Заводить приборы вправе только управляющий. */
  canAdd?: boolean;
  /** Файлы доходят до переписки: без этого остаётся только скачивание. */
  toChat?: boolean;
}

/** Что бывает на вводе дома. Названия те же, что и у квартирных приборов. */
const KINDS: { kind: string; title: string }[] = [
  { kind: 'cold_water', title: 'Холодная вода' },
  { kind: 'hot_water', title: 'Горячая вода' },
  { kind: 'electricity', title: 'Электричество' },
  { kind: 'heating', title: 'Отопление' },
  { kind: 'gas', title: 'Газ' },
];

const number = (value: number): string => value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });

/** Прибор на вводе дома: показание снимают раз в месяц при обходе узла. */
const HouseMeterCard = ({
  api,
  meter,
  onSubmitted,
}: {
  api: DomovoyApi;
  meter: MeterView;
  onSubmitted: () => void;
}) => {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const submit = async (): Promise<void> => {
    // Повтор по Enter, пока показание ещё летит, подал бы его дважды.
    if (sending) return;

    const parsed = parseDecimal(value);

    if (parsed === null) {
      setError('Отправьте показание цифрами');
      return;
    }

    setSending(true);
    setError(null);

    try {
      await api.submitHouseReading(meter.id, parsed);
      setValue('');
      setEditing(false);
      onSubmitted();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Показание не принято');
    } finally {
      setSending(false);
    }
  };

  const expired = meter.verification === 'expired';
  const sent = (meter.submittedThisMonth && !editing) || expired;
  const was =
    meter.lastValue === undefined
      ? `Показаний ещё не было · ${meter.serial}`
      : `${number(meter.lastValue)} ${meter.unit}${meter.lastAt ? ` · ${formatPublished(meter.lastAt)}` : ''}`;

  return (
    <Group>
      <CellSimple
        title={meter.title}
        subtitle={was}
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
          Прибор не считается
        </p>
      ) : null}

      {meter.verification === 'soon' && meter.verifiedUntil ? (
        <p className="hint inset">Поверка до {formatDay(meter.verifiedUntil)}</p>
      ) : null}

      {meter.lastConsumption > 0 ? (
        <CellSimple
          title="Расход за месяц"
          after={
            <span className="report-value">
              {number(meter.lastConsumption)} {meter.unit}
            </span>
          }
          separator
          height="compact"
        />
      ) : null}

      {sent ? null : (
        <>
          <CellInput
            className="field-row"
            type="text"
            inputMode="decimal"
            aria-label={`Показание: ${meter.title}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !sending) void submit();
            }}
            placeholder={`Показание, ${meter.unit}`}
          />

          {value.trim().length > 0 || sending ? (
            <CellAction mode="primary" disabled={sending} onClick={() => void submit()}>
              {sending ? 'Отправляем…' : 'Подать'}
            </CellAction>
          ) : null}
        </>
      )}

      {error ? <ErrorText className="inset">{error}</ErrorText> : null}
    </Group>
  );
};

/** Заведение прибора: заводской номер и что он считает. */
const AddMeter = ({ api, taken, onAdded }: { api: DomovoyApi; taken: string[]; onAdded: () => void }) => {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | null>(null);
  const [serial, setSerial] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const free = KINDS.filter((item) => !taken.includes(item.kind));

  if (free.length === 0) return null;

  const add = async (): Promise<void> => {
    if (!kind || serial.trim().length === 0) return;

    setSending(true);
    setError(null);

    try {
      await api.addHouseMeter(kind, serial.trim());
      setOpen(false);
      setKind(null);
      setSerial('');
      onAdded();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Прибор не заведён');
    } finally {
      setSending(false);
    }
  };

  return (
    <Group>
      <CellSimple
        className={open ? 'row-open' : ''}
        title="Завести прибор"
        showChevron
        height="compact"
        onClick={() => setOpen(!open)}
      />

      {open ? (
        <>
          {free.map((item) => (
            <CellSimple
              key={item.kind}
              title={item.title}
              after={<span className={kind === item.kind ? 'dot dot-good' : 'dot dot-muted'} />}
              separator
              height="compact"
              onClick={() => setKind(item.kind)}
            />
          ))}

          <CellInput
            className="field-row"
            aria-label="Заводской номер"
            value={serial}
            placeholder="Заводской номер"
            onChange={(event) => setSerial(event.target.value)}
          />

          <CellAction
            mode="primary"
            disabled={sending || !kind || serial.trim().length === 0}
            onClick={() => void add()}
          >
            {sending ? 'Заводим…' : 'Готово'}
          </CellAction>
        </>
      ) : null}

      {error ? <ErrorText className="inset">{error}</ErrorText> : null}
    </Group>
  );
};

/** Выгрузка показаний файлом. */
const ExportReadings = ({ api, toChat }: { api: DomovoyApi; toChat: boolean }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const run = async (what: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await what();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось выгрузить показания');
    } finally {
      setBusy(false);
    }
  };

  const download = (): Promise<void> =>
    run(async () => {
      const { filename, blob } = await api.exportReadings();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = filename;
      link.click();

      URL.revokeObjectURL(url);
      toast('Файл сохранён');
    });

  // Клиент MAX не всегда даёт сохранить файл из приложения: тот же файл уходит
  // в переписку с ботом.
  const send = (): Promise<void> =>
    run(async () => {
      await api.sendReadingsExport();
      toast('Показания отправлены в чат с ботом');
    });

  return (
    <CellList mode="island">
      {toChat ? (
        <CellSimple
          title={busy ? 'Собираем выгрузку…' : 'Прислать в переписку с ботом'}
          subtitle={
            error ? <span className="error">{error}</span> : 'Все квартиры за прошлый месяц, файлом'
          }
          showChevron={!busy}
          height="compact"
          onClick={() => void send()}
        />
      ) : null}
      <CellSimple
        title={busy && !toChat ? 'Собираем выгрузку…' : 'Выгрузить в Excel'}
        subtitle={toChat ? undefined : 'Все квартиры за прошлый месяц'}
        showChevron={!busy}
        height="compact"
        separator={toChat}
        onClick={() => void download()}
      />
    </CellList>
  );
};

/** Узел учёта дома: по его показаниям считается общедомовой расход. */
export const HouseMetersScreen = ({ api, canAdd, toChat }: HouseMetersScreenProps) => {
  const meters = useBridgeRequest((alive) => api.until(alive).houseMeters(), [api]);

  if (meters.loading && !meters.data) return <Skeleton count={2} />;

  if (meters.error || !meters.data) {
    return <Failure title="Узел учёта недоступен" error={meters.error} onRetry={meters.reload} />;
  }

  const list = meters.data;

  return (
    <section className="list">
      {list.length === 0 ? (
        <Empty
          icon={<IconMeters />}
          title="Приборов нет"
          hint="Без них общедомовой расход не считается"
        />
      ) : null}

      {list.map((meter) => (
        <HouseMeterCard key={meter.id} api={api} meter={meter} onSubmitted={meters.reload} />
      ))}

      {canAdd ? <AddMeter api={api} taken={list.map((meter) => meter.kind)} onAdded={meters.reload} /> : null}

      <ExportReadings api={api} toChat={toChat !== false} />
    </section>
  );
};
