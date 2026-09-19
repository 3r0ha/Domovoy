import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, type DomovoyApi } from '../api.js';
import { formatPublished } from '../format.js';
import type { HandoffView, ResponsibilityView } from '../views.js';
import { useFit } from './Composer.js';
import { Confirm } from './Confirm.js';
import { ErrorText } from './ErrorText.js';
import { Group } from './Group.js';
import { IconSend } from './icons.js';

export interface ResponsibilityProps {
  api: DomovoyApi;
  requestId: string;
  /** Смена передаёт обращение и записывает ответ, жилец только читает. */
  staff?: boolean;
  /** Заявка закрыта или снята: передавать её больше некуда. */
  closed?: boolean;
  /** Организация смотрящего: подрядчик не передаёт обращение сам себе. */
  own?: string;
  onChanged?: () => void;
}

/** Жилинспекция: туда жалуется жилец со своего экрана, смена себя не проверяет. */
const RESIDENT_ONLY = ['inspection'];

/** Кому смена может передать обращение отсюда. */
const offered = (
  targets: NonNullable<ResponsibilityView['targets']>,
  own: string | undefined,
  organization: string | undefined,
): NonNullable<ResponsibilityView['targets']> =>
  targets.filter(
    (target) =>
      !RESIDENT_ONLY.includes(target.to) && target.organization !== own && target.organization !== organization,
  );

const line = (handoff: HandoffView): string =>
  [
    `${handoff.statusTitle}${handoff.externalId ? `, номер ${handoff.externalId}` : ''}`,
    handoff.status === 'answered' ? '' : `ответ до ${formatPublished(handoff.dueAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');

/** Ответ смежной организации записывает смена: он уходит и жильцу. */
const Answer = ({
  api,
  handoff,
  onAnswered,
}: {
  api: DomovoyApi;
  handoff: HandoffView;
  onAnswered: () => void;
}) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const field = useFit(text);

  const save = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);

    try {
      await api.answerHandoff(handoff.id, text.trim());
      setText('');
      onAnswered();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const ready = !busy && text.trim().length > 0;

  return (
    <>
      <div className="composer passed-answer">
        <textarea
          ref={field}
          className="composer-field"
          aria-label="Что ответила организация"
          rows={1}
          maxLength={2000}
          value={text}
          placeholder="Что ответила организация"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;

            event.preventDefault();
            if (ready) void save();
          }}
        />

        <button
          type="button"
          className="composer-send"
          aria-label="Записать ответ"
          title="Записать ответ"
          disabled={!ready}
          onClick={() => void save()}
        >
          <IconSend />
        </button>
      </div>

      {failed ? <ErrorText>{failed}</ErrorText> : null}
    </>
  );
};

/**
 * Кто отвечает за заявку, на каком основании и что с переданным обращением.
 * Смежная организация ведётся отдельной строкой: её срок ответа не совпадает
 * со сроком работ управляющей организации.
 */
export const Responsibility = ({ api, requestId, staff, closed, own, onChanged }: ResponsibilityProps) => {
  const view = useBridgeRequest((alive) => api.until(alive).responsibility(requestId), [api, requestId]);
  const [passing, setPassing] = useState<string | null>(null);
  // Передача необратима и уходит в другую организацию: сначала спрашиваем.
  const [asking, setAsking] = useState<{ to: string; organization: string; basis: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Ответ без зоны ответственности показывать нечем: раздел просто не рисуется.
  if (!view.data?.title) return null;

  const { title, basis, next, organization } = view.data;
  const targets = staff && !closed ? offered(view.data.targets ?? [], own, organization) : [];
  const handoffs = view.data.handoffs ?? [];

  const pass = async (to: string): Promise<void> => {
    setPassing(to);
    setFailed(null);

    try {
      await api.passRequest(requestId, to);
      setAsking(null);
      view.reload();
      onChanged?.();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
    } finally {
      setPassing(null);
    }
  };

  return (
    <Group title="Кто отвечает">
      <div className="block">
        <p className="request-title">{organization ? `${title}: ${organization}` : title}</p>
        <p className="hint">{basis}</p>
        {next ? <p className="hint">{next}</p> : null}

        {handoffs.map((handoff) => (
          <div key={handoff.id} className="passed">
            <p className="request-title">{handoff.organization}</p>
            <p className={handoff.overdue ? 'hint overdue' : 'hint'}>{line(handoff)}</p>
            <p className="hint aside">{handoff.basis}</p>
            {handoff.answer ? <p className="description">{handoff.answer}</p> : null}

            {staff && handoff.status !== 'answered' && handoff.status !== 'failed' ? (
              <Answer
                api={api}
                handoff={handoff}
                onAnswered={() => {
                  view.reload();
                  onChanged?.();
                }}
              />
            ) : null}
          </div>
        ))}

        {targets.length > 0 ? (
          <div className="inline-keys">
            {targets.map((target) => (
              <button
                key={`${target.to}:${target.organization}`}
                type="button"
                className="inline-btn"
                disabled={passing !== null}
                onClick={() => setAsking(target)}
              >
                {passing === target.to ? 'Передаём…' : `Передать: ${target.organization}`}
              </button>
            ))}
          </div>
        ) : null}

        {asking ? (
          <Confirm
            title={`Передать обращение: ${asking.organization}?`}
            text={`${asking.basis}. Жилец увидит, кому передано и до какого срока ждать ответа.`}
            confirmLabel="Передать"
            busyLabel="Передаём…"
            busy={passing !== null}
            onConfirm={() => void pass(asking.to)}
            onCancel={() => setAsking(null)}
          />
        ) : null}

        {failed ? <ErrorText>{failed}</ErrorText> : null}
      </div>
    </Group>
  );
};
