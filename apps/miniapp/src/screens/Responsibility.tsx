import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import type { Translate } from '@domovoy/i18n';

import { describeFailure, type DomovoyApi } from '../api.js';
import { formatPublished } from '../format.js';
import { useT } from '../i18n.js';
import type { HandoffView, ResponsibilityView } from '../views.js';
import { useFit } from './Composer.js';
import { Confirm } from './Confirm.js';
import { ErrorText } from './ErrorText.js';
import { Group } from './Group.js';
import { IconSend } from './icons.js';

export interface ResponsibilityProps {
  api: DomovoyApi;
  requestId: string;
  /** Категория заявки: по ней же названа зона ответственности. */
  category?: string;
  /** Смена передаёт обращение и записывает ответ, жилец только читает. */
  staff?: boolean;
  /** Заявка закрыта или снята: передавать её больше некуда. */
  closed?: boolean;
  /** Организация смотрящего: подрядчик не передаёт обращение сам себе. */
  own?: string;
  /** Кто ведёт работу: названный в карточке, здесь он второй раз не повторяется. */
  worker?: string;
  onChanged?: () => void;
}

/** Жилинспекция: туда жалуется жилец со своего экрана, смена себя не проверяет. */
const RESIDENT_ONLY = ['inspection'];

/** Зоны ответственности, которые продукт называет сам. */
const KINDS = ['management', 'resource', 'contractor', 'municipal', 'owner'];

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

/** Какими словами граница объяснена жильцу: она следует из зоны и категории. */
const plainKey = (kind: string, category?: string): string | null => {
  if (kind === 'owner') return 'flat';
  if (kind === 'contractor' && category === 'elevator') return 'elevator';
  if (kind === 'management') return category === 'yard' ? 'yard' : 'common';

  return null;
};

/** Название организации содержит имя исполнителя: «ООО «Лифтсервис»» и «Лифтсервис». */
const names = (organization: string, worker?: string): boolean =>
  Boolean(worker) && organization.toLocaleLowerCase('ru').includes((worker ?? '').toLocaleLowerCase('ru'));

/** Зоны, у которых есть и пояснение, что делать дальше. */
const WITH_NEXT = ['flat', 'elevator', 'yard'];

/** Состояния переданного обращения, которые продукт называет сам. */
const HANDOFF_STATUSES = ['sent', 'accepted', 'answered', 'failed'];

const line = (t: Translate, handoff: HandoffView): string =>
  [
    [
      HANDOFF_STATUSES.includes(handoff.status) ? t(`handoff.status.${handoff.status}`) : handoff.statusTitle,
      handoff.externalId ? t('handoff.number', { номер: handoff.externalId }) : '',
    ].join(''),
    handoff.status === 'answered' ? '' : t('handoff.due', { срок: formatPublished(handoff.dueAt) }),
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
export const Responsibility = ({
  api,
  requestId,
  category,
  staff,
  closed,
  own,
  worker,
  onChanged,
}: ResponsibilityProps) => {
  const t = useT();
  const view = useBridgeRequest((alive) => api.until(alive).responsibility(requestId), [api, requestId]);
  const [passing, setPassing] = useState<string | null>(null);
  // Передача необратима и уходит в другую организацию: сначала спрашиваем.
  const [asking, setAsking] = useState<{ to: string; organization: string; basis: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Ответ без зоны ответственности показывать нечем: раздел просто не рисуется.
  if (!view.data?.title) return null;

  const { kind, title, basis, next, organization } = view.data;
  const targets = staff && !closed ? offered(view.data.targets ?? [], own, organization) : [];
  const handoffs = view.data.handoffs ?? [];
  // Смене приходит норма, жильцу, то же словами: норму продукт не переводит.
  const plain = staff ? null : plainKey(kind, category);
  const zone = KINDS.includes(kind) ? t(`responsibility.kind.${kind}`) : title;
  const advice = plain && WITH_NEXT.includes(plain) ? t(`responsibility.next.${plain}`) : next;

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
    <Group title={t('responsibility.title')}>
      <div className="block">
        {/* Зона ответственности это справка, а не заголовок экрана: в размер
            заголовка заявки она перевешивала саму суть обращения. */}
        <p className="zone-title">{organization && !names(organization, worker) ? `${zone}: ${organization}` : zone}</p>
        <p className="hint">{plain ? t(`responsibility.plain.${plain}`) : basis}</p>
        {next ? <p className="hint">{advice}</p> : null}

        {handoffs.map((handoff) => (
          <div key={handoff.id} className="passed">
            <p className="zone-title">{handoff.organization}</p>
            <p className={handoff.overdue ? 'hint overdue' : 'hint'}>{line(t, handoff)}</p>
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
            error={failed}
            onConfirm={() => void pass(asking.to)}
            onCancel={() => setAsking(null)}
          />
        ) : null}

        {failed ? <ErrorText>{failed}</ErrorText> : null}
      </div>
    </Group>
  );
};
