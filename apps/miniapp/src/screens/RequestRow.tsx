import { CellSimple } from '@maxhub/max-ui';

import type { Translate } from '@domovoy/i18n';

import { formatLeft, formatSince, tight, type RequestView } from '../api.js';
import { useT } from '../i18n.js';
import { CategoryTile } from './CategoryTile.js';

/** Короткое состояние для строки списка. */
const short = (t: Translate): Record<string, string> => ({
  new: t('request.short.new'),
  accepted: t('request.short.accepted'),
  in_progress: t('request.short.in_progress'),
  needs_info: t('request.short.needs_info'),
  done: t('request.short.done'),
  confirmed: t('request.short.confirmed'),
  rejected: t('request.short.rejected'),
  withdrawn: t('request.short.withdrawn'),
});

/** Те же состояния словами смены. */
const SHORT_STAFF: Record<string, string> = {
  new: 'новая',
  accepted: 'без мастера',
  done: 'ждёт приёмки',
};

const TONE: Record<string, string> = {
  new: 'dot-work',
  accepted: 'dot-work',
  in_progress: 'dot-work',
  needs_info: 'dot-warn',
  done: 'dot-warn',
  confirmed: 'dot-good',
  rejected: 'dot-muted',
  withdrawn: 'dot-muted',
};

const CLOSED = ['confirmed', 'rejected', 'withdrawn'];

/** Состояние одним словом с цветной точкой: одинаково во всех списках заявок. */
export const RequestState = ({ status, staff }: { status: string; staff?: boolean }) => {
  const t = useT();

  return (
    <span className="row-state">
      <span className={`dot ${TONE[status] ?? 'dot-work'}`} />
      {(staff ? SHORT_STAFF[status] : undefined) ?? short(t)[status] ?? status}
    </span>
  );
};

/**
 * Срок в конце той же строки, что состояние и адрес. У просроченной заявки
 * на его месте стоит «просрочено 5 дней». Точка склеена с предыдущим словом:
 * иначе при переносе она повисает в начале следующей строки.
 */
export const RequestDue = ({ dueAt, overdue }: { dueAt: string; overdue: boolean }) => {
  const t = useT();

  if (overdue) return null;

  const left = formatLeft(dueAt);

  return <span className="row-due">{`\u{a0}· ${left.startsWith('0 ') ? t('request.due.soon') : left}`}</span>;
};

/** Состояние стоит под заголовком. */
export const RequestRow = ({
  request,
  separator,
  staff,
  action,
  onOpen,
}: {
  request: RequestView;
  separator: boolean;
  /** Строка глазами смены. */
  staff?: boolean;
  /** Действие прямо из строки: диспетчер принимает заявку, не открывая её. */
  action?: { title: string; run: () => void; busy?: boolean };
  onOpen: () => void;
}) => {
  const t = useT();

  return (
    <CellSimple
      className={[
        'request-row',
        request.overdue ? 'request-row-overdue' : '',
        action ? 'request-row-acting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      before={<CategoryTile category={request.category} title={request.categoryTitle} />}
      title={request.title}
      subtitle={
        <span className="row-line">
          <span className="row-where">
            {request.overdue && !CLOSED.includes(request.status) ? (
              <span className="row-state">
                <span className="dot dot-bad" />
                {t('request.overdue', { срок: formatSince(request.dueAt) })}
              </span>
            ) : (
              <RequestState status={request.status} {...(staff ? { staff } : {})} />
            )}
            {/* Точка перед адресом рисуется стилем: в узкой строке рядом с кнопкой
                адрес встаёт под состоянием целиком, без неё. */}
            <span className="row-target">{tight(request.target)}</span>
            {staff ? <span className="row-number">{`\u{a0}· ${request.number}`}</span> : null}

            {/* Рядом с кнопкой строка коротка: срок в ней всё равно обрезался бы
                на полуслове, а в карточке заявки он виден целиком. */}
            {action || CLOSED.includes(request.status) || request.status === 'done' ? null : (
              <RequestDue dueAt={request.dueAt} overdue={request.overdue} />
            )}
          </span>
        </span>
      }
      {...(action
        ? {
            after: (
              <button
                type="button"
                className="row-action"
                disabled={action.busy === true}
                onClick={(event) => {
                  event.stopPropagation();
                  action.run();
                }}
              >
                {action.title}
              </button>
            ),
          }
        : { showChevron: true })}
      separator={separator}
      onClick={onOpen}
    />
  );
};
