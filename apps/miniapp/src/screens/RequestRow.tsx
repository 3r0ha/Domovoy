import { CellSimple } from '@maxhub/max-ui';

import { formatLeft, formatSince, tight, type RequestView } from '../api.js';
import { CategoryTile } from './CategoryTile.js';

/** Короткое состояние для строки списка. */
const SHORT: Record<string, string> = {
  new: 'отправлена',
  accepted: 'принята',
  in_progress: 'выполняется',
  needs_info: 'нужен ответ',
  done: 'на приёмке',
  confirmed: 'закрыта',
  rejected: 'отклонена',
  withdrawn: 'снята',
};

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
export const RequestState = ({ status, staff }: { status: string; staff?: boolean }) => (
  <span className="row-state">
    <span className={`dot ${TONE[status] ?? 'dot-work'}`} />
    {(staff ? SHORT_STAFF[status] : undefined) ?? SHORT[status] ?? status}
  </span>
);

/**
 * Срок в конце той же строки, что состояние и адрес. У просроченной заявки
 * на его месте стоит «просрочено 5 дней». Точка склеена с предыдущим словом:
 * иначе при переносе она повисает в начале следующей строки.
 */
export const RequestDue = ({ dueAt, overdue }: { dueAt: string; overdue: boolean }) => {
  if (overdue) return null;

  const left = formatLeft(dueAt);

  return <span className="row-due">{`\u00a0· ${left.startsWith('0 ') ? 'срок истекает' : left}`}</span>;
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
}) => (
  <CellSimple
    className={request.overdue ? 'request-row request-row-overdue' : 'request-row'}
    before={<CategoryTile category={request.category} title={request.categoryTitle} />}
    title={request.title}
    subtitle={
      <span className="row-line">
        <span className="row-where">
          {request.overdue && !CLOSED.includes(request.status) ? (
            <span className="row-state">
              <span className="dot dot-bad" />
              {`просрочено ${formatSince(request.dueAt)}`}
            </span>
          ) : (
            <RequestState status={request.status} {...(staff ? { staff } : {})} />
          )}
          {`\u00a0· ${tight(request.target)}`}
          {staff ? <span className="row-number">{`\u00a0· ${request.number}`}</span> : null}
          {CLOSED.includes(request.status) || request.status === 'done' ? null : (
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
