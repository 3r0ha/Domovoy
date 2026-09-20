import { Button, IconButton, Input, Textarea } from '@maxhub/max-ui';
import { useBridge, useBridgeRequest, useSupports } from '@maxkit/react';
import { useState, type FormEvent } from 'react';

import type { Translate } from '@domovoy/i18n';

import { ApiError, formatTime, parseCount, plural, type AnnouncementView, type DomovoyApi } from '../api.js';
import { spokenLanguage, useT } from '../i18n.js';
import { usePages } from '../use-pages.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { MachineNote } from './MachineNote.js';
import { More } from './More.js';
import { IconNews, IconShare } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface AnnouncementsScreenProps {
  api: DomovoyApi;
  /** Сотруднику показываются охват и форма публикации. */
  showReach?: boolean;
}

const countFlats = (count: number): string => plural(count, 'квартира', 'квартиры', 'квартир');

/** Вид работ теми же категориями, что и заявки. */
const WORK_KINDS: { value: string; title: string }[] = [
  { value: 'plumbing', title: 'Водоснабжение и канализация' },
  { value: 'heating', title: 'Отопление' },
  { value: 'electricity', title: 'Электричество' },
  { value: 'elevator', title: 'Лифт' },
];

/** Публикация: адресат сужается от дома к стояку, охват показывается после отправки. */
const Composer = ({ api, onPublished }: { api: DomovoyApi; onPublished: () => void }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [entrance, setEntrance] = useState('');
  const [riser, setRiser] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ audience: string; recipients: number } | null>(null);
  const [works, setWorks] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');

  const publish = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (title.trim().length === 0 || body.trim().length === 0) {
      setError('Заполните заголовок и текст');
      return;
    }

    if (works && !until) {
      setError('Укажите, до какого момента идут работы');
      return;
    }

    const porch = entrance ? parseCount(entrance, 1, 99) : undefined;
    const pipe = entrance && riser ? parseCount(riser, 1, 99) : undefined;

    if (porch === null || pipe === null) {
      setError('Подъезд и стояк это номера от 1 до 99');
      return;
    }

    const started = from ? new Date(from) : new Date();
    const ends = until ? new Date(until) : null;

    // Окончание раньше начала прошло бы на сервер и закрыло работы до их начала.
    if (ends && ends.getTime() <= started.getTime()) {
      setError('Работы не могут кончиться раньше, чем начались');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const published = await api.publishAnnouncement({
        title: title.trim(),
        body: body.trim(),
        ...(porch === undefined ? {} : { entrance: porch }),
        ...(pipe === undefined ? {} : { riser: pipe }),
        ...(works && ends
          ? {
              works: {
                category: works,
                from: started.toISOString(),
                until: ends.toISOString(),
              },
            }
          : {}),
      });

      setResult({ audience: published.audience, recipients: published.recipients });
      setTitle('');
      setBody('');
      setOpen(false);
      onPublished();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось опубликовать');
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <>
        <Button type="button" className="publish" size="large" stretched onClick={() => setOpen(true)}>
          Опубликовать объявление
        </Button>
        {result ? (
          <p className="lead" role="status">
            Отправлено: {result.audience} · {countFlats(result.recipients)}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section className="card">
      <h2>Новое объявление</h2>

      <form onSubmit={(event) => void publish(event)}>
        <label htmlFor="title">Заголовок</label>
        <Input
          className="field"
          id="title"
          value={title}
          maxLength={200}
          withClearButton={false}
          onChange={(event) => setTitle(event.target.value)}
        />

        <label htmlFor="body">Текст</label>
        <Textarea mode="secondary" id="body" value={body} rows={4} maxLength={4000} onChange={(event) => setBody(event.target.value)} />

        <div className="address">
          <label htmlFor="entrance">
            Подъезд
            <Input
              className="field"
              id="entrance"
              inputMode="numeric"
              value={entrance}
              withClearButton={false}
              placeholder="весь дом"
              onChange={(event) => setEntrance(event.target.value)}
            />
          </label>

          <label htmlFor="riser">
            Стояк
            <Input
              className="field"
              id="riser"
              inputMode="numeric"
              value={riser}
              withClearButton={false}
              placeholder="весь подъезд"
              disabled={entrance === ''}
              onChange={(event) => setRiser(event.target.value)}
            />
          </label>
        </div>

        <label htmlFor="works">Что публикуем</label>
        <select id="works" value={works} onChange={(event) => setWorks(event.target.value)}>
          <option value="">Объявление</option>
          {WORK_KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.title}
            </option>
          ))}
        </select>

        {works ? (
          <>

            <label htmlFor="works-from">Работы начинаются</label>
            <Input
              className="field"
              id="works-from"
              type="datetime-local"
              value={from}
              withClearButton={false}
              onChange={(event) => setFrom(event.target.value)}
            />

            <label htmlFor="works-until">Работы заканчиваются</label>
            <Input
              className="field"
              id="works-until"
              type="datetime-local"
              value={until}
              withClearButton={false}
              onChange={(event) => setUntil(event.target.value)}
            />

          </>
        ) : null}

        {error ? <ErrorText>{error}</ErrorText> : null}

        <Button type="submit" stretched disabled={sending}>
          {sending ? 'Отправляем…' : 'Опубликовать'}
        </Button>
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </form>
    </section>
  );
};

/** Сегодняшнее время показывается без даты: «до 17:45». */
const shortMoment = (isoDate: string, now: Date = new Date()): string => {
  const at = new Date(isoDate);
  const sameDay = at.toDateString() === now.toDateString();
  const time = formatTime(isoDate);

  return sameDay ? time : `${at.toLocaleDateString(spokenLanguage(), { day: 'numeric', month: 'short' })}, ${time}`;
};

/** Когда объявление вышло: сегодняшнее и вчерашнее названы словом, старое датой. */
const publishedAt = (t: Translate, isoDate: string, now: Date = new Date()): string => {
  const at = new Date(isoDate);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const time = formatTime(isoDate);

  if (at.toDateString() === now.toDateString()) return t('news.today', { время: time });
  if (at.toDateString() === yesterday.toDateString()) return t('news.yesterday', { время: time });

  return `${at.toLocaleDateString(spokenLanguage(), { day: 'numeric', month: 'short' })}, ${time}`;
};

/** Три состояния работ: объявлены, идут, закончились. */
const Works = ({ works }: { works: NonNullable<AnnouncementView['works']> }) => {
  const t = useT();
  const now = Date.now();
  const from = new Date(works.from).getTime();
  const until = new Date(works.until).getTime();

  if (now >= until) {
    return (
      <p className="row-state">
        <span className="dot dot-good" />
        {t('news.works.done', { момент: shortMoment(works.until) })}
      </p>
    );
  }

  return (
    <p className="row-state">
      <span className={now >= from ? 'dot dot-warn' : 'dot'} />
      {now >= from
        ? t('news.works.now', { момент: shortMoment(works.until) })
        : t('news.works.from', { момент: shortMoment(works.from) })}
    </p>
  );
};

/** Пересылка объявления в чат. */
const Share = ({ announcement }: { announcement: AnnouncementView }) => {
  const t = useT();
  const bridge = useBridge();
  const toMax = useSupports('shareToMax');
  const native = useSupports('shareNative');

  if (!toMax && !native) return null;

  const text = [
    announcement.title,
    announcement.body,
    t('news.share.audience', { адресат: announcement.audience }),
  ].join('\n\n');

  const share = async (): Promise<void> => {
    try {
      await (toMax ? bridge.shareMaxContent({ text }) : bridge.shareContent({ text }));
    } catch {
      return;
    }
  };

  return (
    <IconButton
      type="button"
      className="share"
      size="small"
      variant="ghost"
      aria-label={t('news.share')}
      onClick={() => void share()}
    >
      <IconShare />
    </IconButton>
  );
};

const AnnouncementCard = ({ announcement, showReach }: { announcement: AnnouncementView; showReach?: boolean }) => {
  const t = useT();

  return (
    <article className="announcement">
      <h2 className="announcement-title">{announcement.title}</h2>

      {/* Абзацы объявления сохраняются: иначе суть аварии слипается со сроком. */}
      <p className="description announcement-body">{announcement.body}</p>

      {announcement.works ? <Works works={announcement.works} /> : null}

      <MachineNote shown={announcement.machineTranslated} />

      <footer>
        <span className="where">
          {publishedAt(t, announcement.createdAt)} · {announcement.audience}

          {showReach ? ` · ${countFlats(announcement.recipients)}` : ''}
        </span>
        <Share announcement={announcement} />
      </footer>
    </article>
  );
};

/** Жилец видит адресованное ему, сотрудник всё по дому. */
/** Сколько объявлений приходит за раз, как и на сервере. */
const PAGE = 20;

export const AnnouncementsScreen = ({ api, showReach }: AnnouncementsScreenProps) => {
  const t = useT();
  const announcements = useBridgeRequest((alive) => api.until(alive).listAnnouncements(), [api]);
  const older = usePages<AnnouncementView>((cursor) => api.listAnnouncements(cursor), PAGE);
  const feed = [...(announcements.data ?? []), ...older.items];

  return (
    <section className="list">
      {showReach ? <Composer api={api} onPublished={announcements.reload} /> : null}

      {announcements.loading && !announcements.data ? <Skeleton count={2} /> : null}

      {announcements.error ? (
        <Failure title={t('news.failed')} error={announcements.error} onRetry={announcements.reload} />
      ) : null}

      {!announcements.loading && announcements.data?.length === 0 ? (
        <Empty
          icon={<IconNews />}
          title={t('news.empty')}
          hint={t('news.empty.hint')}
        />
      ) : null}

      {feed.map((announcement) => (
        <AnnouncementCard key={announcement.id} announcement={announcement} showReach={showReach} />
      ))}

      {older.done || (announcements.data?.length ?? 0) < PAGE ? null : (
        <More loading={older.loading} error={older.error} onMore={() => older.more(feed.at(-1)?.createdAt)} />
      )}
    </section>
  );
};
