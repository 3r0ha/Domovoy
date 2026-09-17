import { Button, CellAction, CellList } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { actionTitle, describeFailure, type DomovoyApi, type RequestView, type StaffMemberView } from '../api.js';
import { useHaptics } from '../haptics.js';
import { Confirm } from './Confirm.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { PhotoField } from './PhotoField.js';
import { useCodeScanner } from './ScanCode.js';
import { usePhotos } from '../use-photos.js';

/** Загрузка исполнителя рядом с его именем. */
const AssigneePicker = ({
  staff,
  value,
  onChange,
}: {
  staff: StaffMemberView[];
  value: string;
  onChange: (id: string) => void;
}) => (
  <label className="assignee">
    Исполнитель
    <select aria-label="Исполнитель" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">не назначен</option>
      {staff.map((person) => (
        <option key={person.id} value={person.id}>
          {person.displayName} · в работе {person.load}
        </option>
      ))}
    </select>
  </label>
);

/** Переходы, которые сервер не примет без объяснения. */
const NEEDS_REASON = ['rejected', 'needs_info'];

const REASON_TITLE: Record<string, string> = {
  rejected: 'Почему отказываем?',
  needs_info: 'Что нужно уточнить?',
};

const REASON_HINT: Record<string, string> = {
  rejected: 'Причину увидит жилец',
  needs_info: 'Вопрос уйдёт жильцу',
};

export interface RequestActionsProps {
  api: DomovoyApi;
  request: RequestView;
  /** Кому можно поручить работу. Пустой список прячет выбор исполнителя. */
  staff?: StaffMemberView[];
  onChanged: () => void;
}

/** Действия над заявкой. */
export const RequestActions = ({ api, request, staff = [], onChanged }: RequestActionsProps) => {
  const [busy, setBusy] = useState(false);
  const [assigneeId, setAssigneeId] = useState(request.assigneeId ?? '');
  const [asking, setAsking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const result = usePhotos(api);
  const haptics = useHaptics();
  const actions = useBridgeRequest(() => api.actions(request.id), [api, request.id, request.status]);
  const scanner = useCodeScanner((code) => void apply('done', undefined, code));

  const apply = async (action: string, comment?: string, provedBy?: string): Promise<void> => {
    setBusy(true);
    setFailed(undefined);

    try {
      await api.transition(request.id, action, {
        ...(comment ? { comment } : {}),
        ...(action === 'in_progress' && assigneeId ? { assigneeId } : {}),
        ...(action === 'done' && result.photos.length > 0 ? { attachments: result.photos } : {}),
        ...(provedBy ? { provedBy } : {}),
      });
      result.reset();
      setAsking(null);
      setReason('');
      haptics.done();
      onChanged();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(false);
    }
  };

  const start = (action: string): void => {
    if (NEEDS_REASON.includes(action)) {
      setAsking(action);
      return;
    }

    void apply(action);
  };

  // Несостоявшийся список действий не выглядит как «делать нечего».
  if (actions.error && !actions.data) {
    return <Failure title="Действия не загрузились" error={actions.error} onRetry={actions.reload} />;
  }

  const available = actions.data?.actions ?? [];
  const main = ['done', 'accepted', 'in_progress'].find((action) => available.includes(action));
  const rest = available.filter((action) => action !== main);
  const picker = available.includes('in_progress') && staff.length > 0;
  const photos = available.includes('done');
  const proving = main === 'done' && scanner.supported;

  return (
    <>
      {failed ? <ErrorText className="actions">{failed}</ErrorText> : null}

      {asking ? (
        <Confirm
          title={REASON_TITLE[asking] ?? 'Почему?'}
          confirmLabel={actionTitle(asking)}
          busyLabel="Отправляем…"
          busy={busy}
          danger={asking === 'rejected'}
          field={{
            value: reason,
            label: REASON_TITLE[asking] ?? 'Причина',
            placeholder: REASON_HINT[asking] ?? '',
            onChange: setReason,
          }}
          onConfirm={() => void apply(asking, reason.trim())}
          onCancel={() => {
            setAsking(null);
            setReason('');
          }}
        />
      ) : null}

      {picker || photos || main ? (
        <section className={picker || photos ? 'block actions' : 'actions'}>
          {picker ? <AssigneePicker staff={staff} value={assigneeId} onChange={setAssigneeId} /> : null}

          {photos || main ? (
            <div className="send-row">
              {photos ? (
                <PhotoField
                  label="Фото результата"
                  count={result.photos.length}
                  uploading={result.uploading}
                  error={result.error}
                  size="large"
                  onPick={result.attach}
                />
              ) : null}

              {main ? (
                <Button
                  type="button"
                  stretched
                  size="large"
                  disabled={busy || result.uploading}
                  onClick={() => (proving ? scanner.scan() : start(main))}
                >
                  {proving ? 'Сканировать код' : actionTitle(main)}
                </Button>
              ) : null}
            </div>
          ) : null}

          {proving ? (
            <>
              {scanner.error ? <ErrorText>{scanner.error}</ErrorText> : null}

              <button type="button" className="link" disabled={busy} onClick={() => void apply('done')}>
                Закрыть без скана
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      {rest.length > 0 ? (
        <CellList className="actions-more" mode="island">
          {rest.map((action) => (
            <CellAction
              key={action}
              className="row-split"
              mode={action === 'rejected' || action === 'withdrawn' ? 'destructive' : 'secondary'}
              disabled={busy || result.uploading}
              onClick={() => start(action)}
            >
              {actionTitle(action)}
            </CellAction>
          ))}
        </CellList>
      ) : null}
    </>
  );
};
