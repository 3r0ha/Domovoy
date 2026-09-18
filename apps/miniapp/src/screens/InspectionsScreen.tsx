import { Button, CellInput, CellSimple, IconButton } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import {
  ApiError,
  describeFailure,
  formatDeadline,
  formatDay,
  type DomovoyApi,
  type InspectionView,
} from '../api.js';
import { useHaptics } from '../haptics.js';
import { usePhotos } from '../use-photos.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconCheck, IconRequests, IconScan, IconWarning } from './icons.js';
import { PhotoField } from './PhotoField.js';
import { useCodeScanner } from './ScanCode.js';
import { Skeleton } from './Skeleton.js';

export interface InspectionsScreenProps {
  api: DomovoyApi;
  /** Открыть заявку, заведённую по найденному недостатку. */
  onOpen: (id: string) => void;
}

/** Заголовок обхода: сначала объект, потом работа. */
const heading = (inspection: InspectionView): string => {
  if (inspection.equipmentTitle) return `${inspection.equipmentTitle} · плановое ТО`;

  const where = inspection.entrance === undefined ? 'весь дом' : `подъезд ${inspection.entrance}`;

  return `${inspection.title} · ${where}`;
};

/** Сколько пунктов пройдено и сколько осталось до срока. */
const progress = (inspection: InspectionView): string =>
  inspection.finishedAt
    ? `закончен ${formatDay(inspection.finishedAt)}`
    : `пройдено ${inspection.checked} из ${inspection.items.length} · ${formatDeadline(inspection.dueAt)}`;

/**
 * Отметка о выезде на обход: наклейка на подъезде или на самом оборудовании.
 * Не обязательна, но её отсутствие видно в сводке.
 */
const OnSite = ({
  api,
  inspection,
  onChecked,
}: {
  api: DomovoyApi;
  inspection: InspectionView;
  onChecked: (updated: InspectionView) => void;
}) => {
  const [failed, setFailed] = useState<string | undefined>(undefined);

  const scanner = useCodeScanner((code) => {
    setFailed(undefined);
    api
      .proveInspection(inspection.id, code)
      .then(onChecked)
      .catch((error: unknown) => setFailed(describeFailure(error)));
  });

  if (inspection.onSite) {
    return <CellSimple title="Обход начат" after={<span className="on-site">на месте</span>} separator height="compact" />;
  }

  if (!scanner.supported) return null;

  return (
    <>
      <CellSimple
        before={
          <span className="tile tile-grey">
            <IconScan />
          </span>
        }
        title="Отметиться на месте"
        subtitle="Сканировать код на объекте"
        height="compact"
        separator
        showChevron
        onClick={scanner.scan}
      />

      {failed ?? scanner.error ? <ErrorText className="inset">{failed ?? scanner.error}</ErrorText> : null}
    </>
  );
};

/** Пункт чек-листа: отметка, а по недостатку ещё и комментарий. */
const Item = ({
  api,
  inspection,
  index,
  onChecked,
}: {
  api: DomovoyApi;
  inspection: InspectionView;
  index: number;
  onChecked: (updated: InspectionView) => void;
}) => {
  const item = inspection.items[index]!;
  const [problem, setProblem] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photos = usePhotos(api);
  const haptics = useHaptics();

  const check = async (state: 'ok' | 'problem'): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const result = await api.checkInspectionItem(inspection.id, index, state, comment, photos.photos);

      haptics.done();
      photos.reset();
      setProblem(false);
      setComment('');
      onChecked(result.inspection);
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : 'Отметка не сохранилась');
    } finally {
      setBusy(false);
    }
  };

  // Отметку меняют тем же рядом кнопок: нажатая подсвечена, соседняя переносит пункт.
  const marks = (
    <span className="check-marks">
      <IconButton
        type="button"
        size="small"
        variant={item.state === 'ok' ? 'primary' : 'secondary'}
        aria-label={`В порядке: ${item.title}`}
        aria-pressed={item.state === 'ok'}
        disabled={busy}
        onClick={() => void check('ok')}
      >
        <IconCheck />
      </IconButton>
      <IconButton
        type="button"
        size="small"
        variant={item.state === 'problem' ? 'primary' : 'secondary'}
        aria-label={`Недостаток: ${item.title}`}
        aria-pressed={item.state === 'problem'}
        disabled={busy}
        onClick={() => setProblem(true)}
      >
        <IconWarning />
      </IconButton>
    </span>
  );

  return (
    <>
      <CellSimple
        title={item.title}
        {...(item.comment ? { subtitle: item.comment } : {})}
        after={problem ? null : marks}
        separator
        height="compact"
      />

      {problem ? (
        <div className="check-form">
          <CellInput
            className="field-row"
            aria-label={`Что не так: ${item.title}`}
            value={comment}
            placeholder="Что именно не так"
            onChange={(event) => setComment(event.target.value)}
          />

          <div className="send-row">
            <PhotoField
              label="Фото"
              count={photos.photos.length}
              uploading={photos.uploading}
              error={photos.error}
              size="large"
              onPick={photos.attach}
            />

            <Button
              type="button"
              stretched
              size="large"
              disabled={busy || photos.uploading || comment.trim().length === 0}
              onClick={() => void check('problem')}
            >
              {busy ? 'Отправляем…' : 'Завести заявку'}
            </Button>
          </div>

          <button type="button" className="link check-cancel" disabled={busy} onClick={() => setProblem(false)}>
            Отмена
          </button>
        </div>
      ) : null}

      {error ? <ErrorText className="inset">{error}</ErrorText> : null}
    </>
  );
};

/** Осмотры общего имущества. */
export const InspectionsScreen = ({ api, onOpen }: InspectionsScreenProps) => {
  const rounds = useBridgeRequest(() => api.inspections(), [api]);
  const [changed, setChanged] = useState<Record<string, InspectionView>>({});
  const [opened, setOpened] = useState<string | null>(null);

  if (rounds.loading && !rounds.data) return <Skeleton count={2} />;

  if (rounds.error || !rounds.data) {
    return <Failure title="Осмотры не загрузились" error={rounds.error} onRetry={rounds.reload} />;
  }

  const list = rounds.data.map((inspection) => changed[inspection.id] ?? inspection);

  if (list.length === 0) {
    return <Empty icon={<IconRequests />} title="Осмотров нет" hint="Продукт заведёт их, когда подойдёт срок" />;
  }

  const current = opened ?? list.find((inspection) => !inspection.finishedAt)?.id;
  const open = list.find((inspection) => inspection.id === current);
  const rest = list.filter((inspection) => inspection.id !== current);

  return (
    <div className="list">
      {open ? (
        <Group>
          <CellSimple
            title={heading(open)}
            subtitle={<span className={open.overdue ? 'overdue' : undefined}>{progress(open)}</span>}
            showChevron
            onClick={() => setOpened('')}
          />

          {open.finishedAt ? null : (
            <OnSite
              api={api}
              inspection={open}
              onChecked={(updated) => setChanged((state) => ({ ...state, [updated.id]: updated }))}
            />
          )}

          {open.finishedAt
            ? null
            : open.items.map((entry, index) => (
                // Ключ с обходом: у другого обхода тот же пункт начинается с чистой заметки.
                <Item
                  key={`${open.id}-${index}`}
                  api={api}
                  inspection={open}
                  index={index}
                  onChecked={(updated) => setChanged((state) => ({ ...state, [updated.id]: updated }))}
                />
              ))}

          {open.requestIds.length > 0 ? (
            <CellSimple
              title="Заявки по осмотру"
              after={<span className="report-value">{open.requestIds.length}</span>}
              separator
              height="compact"
              showChevron
              onClick={() => onOpen(open.requestIds.at(-1)!)}
            />
          ) : null}
        </Group>
      ) : null}

      {rest.length > 0 ? (
        <Group {...(open ? { title: 'Остальные обходы' } : {})}>
          {rest.map((inspection, index) => (
            <CellSimple
              key={inspection.id}
              title={heading(inspection)}
              subtitle={<span className={inspection.overdue ? 'overdue' : undefined}>{progress(inspection)}</span>}
              separator={index > 0}
              showChevron
              onClick={() => setOpened(inspection.id)}
            />
          ))}
        </Group>
      ) : null}
    </div>
  );
};
