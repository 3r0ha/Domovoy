import { CellSimple } from '@maxhub/max-ui';

import type { Translate } from '@domovoy/i18n';

import { dueNow, formatDayAt, formatLeft, formatSince, tight, type RequestView } from '../api.js';
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

/*
 * Цвет говорит, что с заявкой: синий, работа идёт; оранжевый, ждут человека;
 * зелёный, закрыта работой; серый, закрыта без неё. Плашкой, а не точкой
 * в восемь пикселей: список из пяти заявок должен читаться взглядом.
 */
const TONE: Record<string, string> = {
  new: 'state-work',
  accepted: 'state-work',
  in_progress: 'state-work',
  needs_info: 'state-wait',
  done: 'state-wait',
  confirmed: 'state-good',
  rejected: 'state-muted',
  withdrawn: 'state-muted',
};

const CLOSED = ['confirmed', 'rejected', 'withdrawn'];

/** Состояние одним словом цветной плашкой: одинаково во всех списках заявок. */
export const RequestState = ({ status, staff }: { status: string; staff?: boolean }) => {
  const t = useT();

  return (
    <span className={`state ${TONE[status] ?? 'state-work'}`}>
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

  const left = dueNow(dueAt) ? t('request.due.soon') : formatLeft(dueAt);

  return <span className="row-due">{` ·\u{a0}${left}`}</span>;
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
        // Авария должна читаться до текста строки: в списке одинаковых карточек
        // самое срочное иначе ничем не выделено.
        request.priority === 'emergency' && !CLOSED.includes(request.status) ? 'request-row-alarm' : '',
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
              <span className="state state-bad">{t('request.overdue', { срок: formatSince(request.dueAt) })}</span>
            ) : (
              <RequestState status={request.status} {...(staff ? { staff } : {})} />
            )}
            {/* После плашки состояния разделителя нет: расстояние держит отступ.
                Знак повисал в начале строки, когда адрес переносился. */}
            <span className="row-target">{tight(request.target)}</span>
            {staff ? <span className="row-number">{` ·\u{a0}${request.number}`}</span> : null}

            {/* Назначенное время визита важнее остатка срока: к нему ждут дома. */}
            {request.appointment?.at ? (
              <span className="row-visit">
                {` ·\u{a0}${t('day.visitAt', { когда: formatDayAt(request.appointment.at) })}`}
              </span>
            ) : null}

            {request.machineTranslated ? (
              <span className="row-machine">{` ·\u{a0}${t('translation.machine')}`}</span>
            ) : null}

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
