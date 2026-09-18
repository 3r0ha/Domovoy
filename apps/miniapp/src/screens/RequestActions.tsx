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
  meId,
  onChange,
}: {
  staff: StaffMemberView[];
  value: string;
  /** Кто смотрит: себя в списке видно первой строкой. */
  meId?: string;
  onChange: (id: string) => void;
}) => (
  <label className="assignee">
    Исполнитель
    <select aria-label="Исполнитель" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Выберите исполнителя</option>
      {staff.map((person) => (
        <option key={person.id} value={person.id}>
          {person.id === meId ? 'Беру на себя' : person.displayName} · в работе {person.load}
        </option>
      ))}
    </select>
  </label>
);

/** Переходы, которые сервер не примет без объяснения. */
const NEEDS_REASON = ['rejected', 'needs_info', 'done'];

const REASON_TITLE: Record<string, string> = {
  rejected: 'Почему отказываем?',
  needs_info: 'Что нужно уточнить?',
  done: 'Что сделали?',
};

const REASON_HINT: Record<string, string> = {
  rejected: 'Причину увидит жилец',
  needs_info: 'Вопрос уйдёт жильцу',
  done: 'Отметку увидит жилец',
};

/**
 * Приёмку за жильца и возврат в работу смена объясняет: заявку закрывают
 * со слов человека по телефону, и в истории должно остаться, с чьих именно.
 */
const AFTER_DONE_TITLE: Record<string, string> = {
  confirmed: 'Кто принял работу?',
  in_progress: 'Что осталось сделать?',
};

const AFTER_DONE_HINT: Record<string, string> = {
  confirmed: 'Запишем в историю заявки',
  in_progress: 'Увидит исполнитель',
};

const AFTER_DONE_LABEL: Record<string, string> = {
  confirmed: 'Закрыть заявку',
  in_progress: 'Вернуть в работу',
};

export interface RequestActionsProps {
  api: DomovoyApi;
  request: RequestView;
  /** Кому можно поручить работу. Пустой список прячет выбор исполнителя. */
  staff?: StaffMemberView[];
  /** Кто смотрит: он же и берёт наряд на себя. */
  meId?: string;
  /** Роль сама выполняет работу: мастер и подрядчик уходят в работу без выбора. */
  selfAssigned?: boolean;
  onChanged: () => void;
}

/** Действия над заявкой. */
export const RequestActions = ({
  api,
  request,
  staff = [],
  meId,
  selfAssigned,
  onChanged,
}: RequestActionsProps) => {
  const [busy, setBusy] = useState(false);
  const [assigneeId, setAssigneeId] = useState(request.assigneeId ?? '');
  const [asking, setAsking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [proved, setProved] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const result = usePhotos(api);
  const haptics = useHaptics();
  const actions = useBridgeRequest(() => api.actions(request.id), [api, request.id, request.status]);

  // Наклейка читается до вопроса о работе: код доезжает до отправки вместе с отметкой.
  const scanner = useCodeScanner((code) => {
    setProved(code);
    setAsking('done');
  });

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
      setProved(undefined);
      haptics.done();
      onChanged();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(false);
    }
  };

  // Заявка уже сдана: и приёмка за жильца, и возврат в работу идут с объяснением.
  const afterDone = request.status === 'done';
  const explains = (action: string): boolean => NEEDS_REASON.includes(action) || afterDone;
  const title = (action: string): string => (afterDone ? (AFTER_DONE_LABEL[action] ?? actionTitle(action)) : actionTitle(action));

  const start = (action: string): void => {
    if (explains(action)) {
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
  const order = afterDone ? ['confirmed', 'in_progress'] : ['done', 'accepted', 'in_progress'];
  const main = order.find((action) => available.includes(action));
  const rest = available.filter((action) => action !== main);
  // На сданной заявке исполнителя не меняют: там либо приёмка, либо возврат тому же мастеру.
  const picker = available.includes('in_progress') && staff.length > 0 && !afterDone;
  const photos = available.includes('done');
  const proving = main === 'done' && scanner.supported;

  // Ничей наряд в работе никем и не делается: без исполнителя переход закрыт.
  const unassigned = !afterDone && !selfAssigned && !request.assigneeId && assigneeId.length === 0;
  const blocked = (action: string): boolean => action === 'in_progress' && unassigned;
  const needsAssignee = main !== undefined && blocked(main);

  return (
    <>
      {failed ? <ErrorText className="actions">{failed}</ErrorText> : null}

      {asking ? (
        <Confirm
          title={(afterDone ? AFTER_DONE_TITLE[asking] : REASON_TITLE[asking]) ?? 'Почему?'}
          confirmLabel={title(asking)}
          busyLabel="Отправляем…"
          busy={busy}
          danger={asking === 'rejected'}
          field={{
            value: reason,
            label: (afterDone ? AFTER_DONE_TITLE[asking] : REASON_TITLE[asking]) ?? 'Причина',
            placeholder: (afterDone ? AFTER_DONE_HINT[asking] : REASON_HINT[asking]) ?? '',
            onChange: setReason,
          }}
          onConfirm={() => void apply(asking, reason.trim(), asking === 'done' ? proved : undefined)}
          onCancel={() => {
            setAsking(null);
            setReason('');
            setProved(undefined);
          }}
        />
      ) : null}

      {picker || photos || main ? (
        <section className={picker || photos ? 'block actions' : 'actions'}>
          {picker ? (
            <AssigneePicker
              staff={staff}
              value={assigneeId}
              {...(meId ? { meId } : {})}
              onChange={setAssigneeId}
            />
          ) : null}

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
                  disabled={busy || result.uploading || needsAssignee}
                  onClick={() => (proving ? scanner.scan() : start(main))}
                >
                  {proving ? 'Сканировать код' : title(main)}
                </Button>
              ) : null}
            </div>
          ) : null}

          {needsAssignee ? <p className="hint">Выберите исполнителя: без него заявка в работу не уйдёт</p> : null}

          {proving ? (
            <>
              {scanner.error ? <ErrorText>{scanner.error}</ErrorText> : null}

              <button type="button" className="link" disabled={busy} onClick={() => start('done')}>
                Сдать без кода
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
              disabled={busy || result.uploading || blocked(action)}
              onClick={() => start(action)}
            >
              {title(action)}
            </CellAction>
          ))}
        </CellList>
      ) : null}
    </>
  );
};
