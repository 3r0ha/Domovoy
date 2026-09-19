import { Button, CellSimple, Input, Textarea } from '@maxhub/max-ui';
import { useBridge, useBridgeRequest, useSupports } from '@maxkit/react';
import { useEffect, useState } from 'react';

import {
  describeFailure,
  plural,
  type DomovoyApi,
  type StickerObjectView,
  type StickerStyleView,
} from '../api.js';
import { useHaptics } from '../haptics.js';
import { svgUrl } from '../sticker-image.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconSticker } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface StickersScreenProps {
  api: DomovoyApi;
  /** Смене доступен весь дом и лист для печати. */
  staff?: boolean;
}

/** Сколько ждать после последней правки надписи, прежде чем перерисовать. */
const REDRAW_DELAY_MS = 400;

/** Длина надписи: столько помещается под кодом. */
const NOTE_MAX_LENGTH = 80;

/** Порядок групп: сначала то, что клеят на стену, коды квартир, в конце. */
const GROUPS: { title: string; tone: string; kinds: StickerObjectView['kind'][] }[] = [
  { title: 'Подъезды и стояки', tone: 'tile-teal', kinds: ['entrance', 'riser', 'building'] },
  { title: 'Оборудование', tone: 'tile-grey', kinds: ['equipment'] },
  { title: 'Коды квартир для квитанций', tone: 'tile-blue', kinds: ['apartment'] },
];

/** Объекты по группам: в доме их сотни, сплошным списком не найти. */
const byGroup = (
  objects: readonly StickerObjectView[],
): { title: string; tone: string; objects: StickerObjectView[] }[] =>
  GROUPS.map((group) => ({
    title: group.title,
    tone: group.tone,
    objects: objects.filter((object) => group.kinds.includes(object.kind)),
  })).filter((group) => group.objects.length > 0);

const found = (object: StickerObjectView, query: string): boolean => {
  const needle = query.trim().toLowerCase();

  return needle.length === 0 || `${object.caption}\n${object.target}`.toLowerCase().includes(needle);
};

/** Стиль выбирается образцом, а не названием: цвета видно до отрисовки. */
const Styles = ({
  styles,
  value,
  onPick,
}: {
  styles: readonly StickerStyleView[];
  value: string;
  onPick: (name: string) => void;
}) => (
  <div className="styles">
    {styles.map((style) => (
      <button
        key={style.name}
        type="button"
        className={style.name === value ? 'chip chip-on' : 'chip'}
        aria-pressed={style.name === value}
        onClick={() => {
          onPick(style.name);
        }}
      >
        <span className="swatch" style={{ background: style.paper, borderColor: style.ink }}>
          <span className="swatch-ink" style={{ background: style.accent }} />
        </span>
        {style.title}
      </button>
    ))}
  </div>
);

/** Наклейка выбранного объекта: стиль, своя надпись и что с ней делать дальше. */
const Sticker = ({
  api,
  object,
  styles,
  onBack,
}: {
  api: DomovoyApi;
  object: StickerObjectView;
  styles: readonly StickerStyleView[];
  onBack: () => void;
}) => {
  const bridge = useBridge();
  const toMax = useSupports('shareToMax');
  const native = useSupports('shareNative');
  const haptics = useHaptics();

  const [style, setStyle] = useState(styles[0]?.name ?? 'classic');
  const [note, setNote] = useState('');
  const [typed, setTyped] = useState('');
  const [svg, setSvg] = useState<string | null>(null);
  const [busy, setBusy] = useState<'image' | 'document' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setNote(typed.trim());
    }, REDRAW_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [typed]);

  useEffect(() => {
    let current = true;

    api
      .stickerImage(object.payload, { style, ...(note ? { note } : {}) })
      .then((drawn) => {
        if (current) {
          setSvg(drawn);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (current) setError(describeFailure(reason));
      });

    return () => {
      current = false;
    };
  }, [api, object.payload, style, note]);

  /** Наклейка уходит в переписку с ботом: там её пересылают и сохраняют. */
  const send = async (as: 'image' | 'document'): Promise<void> => {
    setBusy(as);
    setError(null);
    setSaid(null);

    try {
      const sent = await api.sendSticker({
        payload: object.payload,
        style,
        ...(note ? { note } : {}),
        as,
      });

      haptics.done();

      const forwarded =
        sent.as === 'image' && sent.messageId && toMax
          ? await bridge
              .shareMaxContent({ mid: sent.messageId, chatType: 'DIALOG' })
              .then(() => true)
              .catch(() => false)
          : false;

      setSaid(
        forwarded
          ? 'Наклейка отправлена.'
          : sent.as === 'image'
            ? 'Наклейка в переписке с ботом: перешлите её в любой чат.'
            : 'Наклейка пришла файлом: откройте его и распечатайте.',
      );
    } catch (reason: unknown) {
      haptics.failed();
      setError(describeFailure(reason));
    } finally {
      setBusy(null);
    }
  };

  const share = async (): Promise<void> => {
    const text = note ? `${object.caption}. ${note}` : object.caption;

    await (toMax
      ? bridge.shareMaxContent({ text, link: object.link })
      : bridge.shareContent({ text, link: object.link })
    ).catch(() => undefined);
  };

  return (
    <section className="card sticker">
      <h2>{object.caption}</h2>
      <p className="hint">Скан открывает заявку по этому объекту</p>

      {svg ? (
        <div className="sticker-paper">
          <img className="sticker-preview" src={svgUrl(svg)} alt={`Наклейка: ${object.caption}`} />
        </div>
      ) : (
        <Skeleton count={1} />
      )}

      <Styles styles={styles} value={style} onPick={setStyle} />

      <Textarea
        mode="secondary"
        id="sticker-note"
        aria-label="Своя надпись"
        rows={2}
        maxLength={NOTE_MAX_LENGTH}
        value={typed}
        placeholder="Своя надпись под кодом"
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />

      <p className="hint">Надпись печатается на наклейке: её видно и в пересланной картинке.</p>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {said ? <p className="done">{said}</p> : null}

      <Button type="button" stretched disabled={busy !== null} onClick={() => void send('image')}>
        {busy === 'image' ? 'Отправляем…' : 'Переслать в чат'}
      </Button>

      <Button
        type="button"
        stretched
        variant="secondary"
        disabled={busy !== null}
        onClick={() => void send('document')}
      >
        {busy === 'document' ? 'Отправляем…' : 'Файлом для печати'}
      </Button>

      <div className="row-links">
        <button type="button" className="link" onClick={onBack}>
          К другим объектам
        </button>

        {toMax || native ? (
          <button type="button" className="link quiet" onClick={() => void share()}>
            Поделиться ссылкой
          </button>
        ) : null}
      </div>
    </section>
  );
};

/** Лист для печати всего дома: его заказывает смена. */
const Sheet = ({ api }: { api: DomovoyApi }) => {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const haptics = useHaptics();

  const order = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const sheet = await api.stickerSheet();

      haptics.done();
      setSaid(`Лист отправлен файлом: на нём ${plural(sheet.count, 'код', 'кода', 'кодов')}. Откройте и распечатайте.`);
    } catch (reason: unknown) {
      haptics.failed();
      setError(describeFailure(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Лист для печати</h2>
      <p className="hint">Все коды дома на одной странице. Придёт файлом в переписку с ботом.</p>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {said ? <p className="done">{said}</p> : null}

      <Button type="button" stretched disabled={busy} onClick={() => void order()}>
        {busy ? 'Готовим…' : 'Прислать лист в переписку'}
      </Button>
    </section>
  );
};

/** Наклейки с кодами объектов: их печатают, пересылают и сохраняют. */
export const StickersScreen = ({ api, staff }: StickersScreenProps) => {
  const stickers = useBridgeRequest((alive) => api.until(alive).stickers(), [api]);
  const [payload, setPayload] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  if (stickers.loading && !stickers.data) return <Skeleton count={3} />;

  if (stickers.error && !stickers.data) {
    return <Failure title="Наклейки недоступны" error={stickers.error} onRetry={stickers.reload} />;
  }

  const objects = stickers.data?.objects ?? [];
  const chosen = objects.find((object) => object.payload === payload);

  if (chosen) {
    return (
      <Sticker
        api={api}
        object={chosen}
        styles={stickers.data?.styles ?? []}
        onBack={() => {
          setPayload(null);
        }}
      />
    );
  }

  if (objects.length === 0) {
    return (
      <Empty
        icon={<IconSticker />}
        title="Объектов с кодами нет"
        hint="Заведите подъезды и оборудование дома, и коды появятся"
      />
    );
  }

  const shown = objects.filter((object) => found(object, query));

  return (
    <section className="list">
      {staff ? <Sheet api={api} /> : null}

      {objects.length > 8 ? (
        <Input
          className="field"
          id="stickers-search"
          type="search"
          aria-label="Поиск объекта"
          withClearButton
          value={query}
          placeholder="Подъезд, лифт или номер квартиры"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      ) : null}

      {shown.length === 0 ? <p className="lead">Ничего не нашлось</p> : null}

      {byGroup(shown).map((group) => (
        <Group key={group.title} title={group.title}>
          {group.objects.map((object, index) => (
            <CellSimple
              key={object.payload}
              before={
                <span className={`tile ${group.tone}`}>
                  <IconSticker />
                </span>
              }
              title={object.caption}
              showChevron
              height="compact"
              separator={index > 0}
              onClick={() => {
                setPayload(object.payload);
              }}
            />
          ))}
        </Group>
      ))}
    </section>
  );
};
