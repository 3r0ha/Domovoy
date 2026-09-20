import { Button, Input, Textarea } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useEffect, useRef, useState } from 'react';

import {
  ApiError,
  plural,
  type BroadcastAimView,
  type BroadcastScopeView,
  type BroadcastTargetsView,
  type DomovoyApi,
} from '../api.js';
import { useHaptics } from '../haptics.js';
import { useToast } from '../toast.js';
import { Confirm } from './Confirm.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { IconSend } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface BroadcastScreenProps {
  api: DomovoyApi;
}

type Kind = BroadcastScopeView['kind'];

/** Столько же знаков принимает сервер. */
const TEXT_MAX_LENGTH = 2000;

/** Сколько ждать после последней правки номеров квартир, прежде чем считать охват. */
const TYPING_DELAY_MS = 400;

const KINDS: { kind: Kind; title: string }[] = [
  { kind: 'building', title: 'Весь дом' },
  { kind: 'entrance', title: 'Подъезд' },
  { kind: 'riser', title: 'Стояк' },
  { kind: 'apartments', title: 'Квартиры' },
  { kind: 'debtors', title: 'Должники' },
  { kind: 'meters', title: 'Без показаний' },
  { kind: 'poll', title: 'Не голосовали' },
  { kind: 'staff', title: 'Смена' },
];

const people = (count: number): string => plural(count, 'человек', 'человека', 'человек');

/** Адресаты, которые в этом доме есть: пустых кнопок быть не должно. */
const kindsFor = (targets: BroadcastTargetsView): { kind: Kind; title: string }[] =>
  KINDS.filter((item) => {
    if (item.kind === 'entrance') return targets.entrances.length > 1;
    if (item.kind === 'riser') return targets.entrances.some((entrance) => entrance.risers.length > 1);
    if (item.kind === 'poll') return targets.polls.length > 0;
    if (item.kind === 'staff') return targets.staff > 1;

    return true;
  });

/** Номера квартир из строки «12, 14 18». */
const flatNumbers = (said: string): number[] => [
  ...new Set(
    said
      .split(/\D+/)
      .filter(Boolean)
      .map(Number)
      .filter((number) => Number.isInteger(number) && number > 0),
  ),
];

const Chips = ({
  items,
  value,
  onPick,
}: {
  items: readonly { id: string; title: string }[];
  value: string;
  onPick: (id: string) => void;
}) => {
  const chosen = useRef<HTMLButtonElement | null>(null);
  const picked = useRef(false);

  // Выбранное подтягивается в видимую часть: ряд шире экрана и прокручивается.
  // Первый показ пропускается, иначе экран прокручивается сам при открытии.
  useEffect(() => {
    if (picked.current) chosen.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    else picked.current = true;
  }, [value]);

  return (
    <div className="filters">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          ref={item.id === value ? chosen : null}
          className={item.id === value ? 'chip chip-on' : 'chip'}
          aria-pressed={item.id === value}
          onClick={() => {
            onPick(item.id);
          }}
        >
          {item.title}
        </button>
      ))}
    </div>
  );
};

/** Рассылка по личным перепискам: адресат, охват и текст на одном экране. */
export const BroadcastScreen = ({ api }: BroadcastScreenProps) => {
  const targets = useBridgeRequest((alive) => api.until(alive).broadcastTargets(), [api]);
  const haptics = useHaptics();

  const [kind, setKind] = useState<Kind>('building');
  const [entrance, setEntrance] = useState<number | null>(null);
  const [riser, setRiser] = useState<number | null>(null);
  const [flats, setFlats] = useState('');
  const [pollId, setPollId] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [aim, setAim] = useState<BroadcastAimView | null>(null);
  const [aimError, setAimError] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const say = useToast();

  const numbers = flatNumbers(flats);

  const scope: BroadcastScopeView | null =
    kind === 'entrance'
      ? entrance === null
        ? null
        : { kind, entrance }
      : kind === 'riser'
        ? entrance === null || riser === null
          ? null
          : { kind, entrance, riser }
        : kind === 'apartments'
          ? numbers.length === 0
            ? null
            : { kind, numbers }
          : kind === 'poll'
            ? pollId === null
              ? null
              : { kind, pollId }
            : { kind };

  // Ключ адресата: по нему видно, что охват пора пересчитать.
  const key = scope ? JSON.stringify(scope) : '';

  useEffect(() => {
    if (key === '') {
      setAim(null);
      setAimError(null);
      return undefined;
    }

    let dropped = false;

    setCounting(true);

    const count = (): void => {
      api
        .previewBroadcast(JSON.parse(key) as BroadcastScopeView)
        .then((counted) => {
          if (dropped) return;

          setAim(counted);
          setAimError(null);
        })
        .catch((reason: unknown) => {
          if (dropped) return;

          setAim(null);
          setAimError(reason instanceof ApiError ? reason.message : 'Охват не посчитался');
        })
        .finally(() => {
          if (!dropped) setCounting(false);
        });
    };

    // Номера квартир набирают руками: пересчёт ждёт, пока перестанут печатать.
    if (!key.includes('"apartments"')) {
      count();

      return () => {
        dropped = true;
      };
    }

    const timer = setTimeout(count, TYPING_DELAY_MS);

    return () => {
      dropped = true;
      clearTimeout(timer);
    };
  }, [api, key]);

  useEffect(() => {
    setConfirming(false);
  }, [key, text]);

  if (targets.loading && !targets.data) return <Skeleton count={2} />;

  if (targets.error || !targets.data) {
    return <Failure title="Рассылка недоступна" error={targets.error} onRetry={targets.reload} />;
  }

  const house = targets.data;

  if (house.flats === 0) {
    return <Empty icon={<IconSend />} title="Рассылать некому" hint="В доме ещё нет квартир" />;
  }

  const chosen = house.entrances.find((item) => item.entrance === entrance);

  const pick = (next: Kind): void => {
    haptics.picked();
    setKind(next);
    setError(null);

    if (next === 'entrance' || next === 'riser') {
      setEntrance(house.entrances[0]?.entrance ?? null);
      setRiser(null);
    }

    if (next === 'poll') setPollId(house.polls[0]?.id ?? null);
  };

  const send = async (): Promise<void> => {
    if (!scope) return;

    if (text.trim().length === 0) {
      haptics.failed();
      setError('Напишите текст сообщения');
      return;
    }

    if (!confirming) {
      setConfirming(true);
      return;
    }

    setSending(true);
    setError(null);

    try {
      const result = await api.sendBroadcast(scope, text.trim());

      haptics.done();
      say(`Отправлено: ${result.audience} ·\u00a0${people(result.sent)}`);
      setText('');
      setConfirming(false);
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : 'Рассылка не ушла');
    } finally {
      setSending(false);
    }
  };

  const reach = (): string => {
    if (!scope) {
      if (kind === 'apartments') return 'Укажите номера квартир';
      if (kind === 'poll') return 'Выберите собрание';

      return entrance === null ? 'Выберите подъезд' : 'Выберите стояк';
    }

    if (aimError) return aimError;
    if (counting || !aim) return 'Считаем охват…';
    if (aim.recipients === 0) return 'Никто из них не в MAX';

    const silent = aim.people - aim.recipients;

    // Точка не остаётся висеть в конце строки: она склеена со следующим словом.
    const got = aim.recipients === 1 ? 'получит' : 'получат';

    return `${aim.audience} ·\u00a0${got} ${people(aim.recipients)}${silent > 0 ? ` из ${aim.people}` : ''}`;
  };

  const ready = scope !== null && (aim?.recipients ?? 0) > 0 && text.trim().length > 0;

  return (
    <div className="list">
      <section className="card">
        <h2>Кому</h2>

        <Chips
          items={kindsFor(house).map((item) => ({ id: item.kind, title: item.title }))}
          value={kind}
          onPick={(next) => pick(next as Kind)}
        />

        {kind === 'entrance' || kind === 'riser' ? (
          <Chips
            items={house.entrances.map((item) => ({
              id: String(item.entrance),
              title: `Подъезд ${item.entrance}`,
            }))}
            value={entrance === null ? '' : String(entrance)}
            onPick={(next) => {
              haptics.picked();
              setEntrance(Number(next));
              setRiser(null);
            }}
          />
        ) : null}

        {kind === 'riser' && chosen ? (
          <Chips
            items={chosen.risers.map((item) => ({ id: String(item.riser), title: `Стояк ${item.riser}` }))}
            value={riser === null ? '' : String(riser)}
            onPick={(next) => {
              haptics.picked();
              setRiser(Number(next));
            }}
          />
        ) : null}

        {kind === 'poll' ? (
          <Chips
            items={house.polls.map((poll) => ({ id: poll.id, title: poll.title }))}
            value={pollId ?? ''}
            onPick={(next) => {
              haptics.picked();
              setPollId(next);
            }}
          />
        ) : null}

        {kind === 'apartments' ? (
          <>
            <label htmlFor="flats">Номера квартир через запятую</label>
            <Input
              className="field"
              id="flats"
              inputMode="numeric"
              value={flats}
              placeholder="12, 14, 18"
              withClearButton={false}
              onChange={(event) => setFlats(event.target.value)}
            />
          </>
        ) : null}

        <p className="row-state cast-reach">
          <span className={ready ? 'dot dot-good' : 'dot'} />
          {reach()}
        </p>
      </section>

      <section className="card">
        <h2>Сообщение</h2>

        <Textarea
          mode="secondary"
          id="broadcast-text"
          aria-label="Текст сообщения"
          rows={5}
          value={text}
          maxLength={TEXT_MAX_LENGTH}
          placeholder="Сообщение жильцам"
          onChange={(event) => setText(event.target.value)}
        />

        {error ? <ErrorText>{error}</ErrorText> : null}

        <Button type="button" stretched disabled={!ready || sending} onClick={() => void send()}>
          {sending ? 'Отправляем…' : 'Отправить'}
        </Button>
      </section>

      {confirming ? (
        <Confirm
          title="Отправить рассылку?"
          text={reach()}
          confirmLabel="Отправить"
          busy={sending}
          onConfirm={() => void send()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
};
