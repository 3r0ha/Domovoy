import { CellAction, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { ApiError, money, plural, rubles, type DebtorView, type DomovoyApi } from '../api.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { useHaptics } from '../haptics.js';
import { IconRuble } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface DebtorsScreenProps {
  api: DomovoyApi;
}

/** Квартира должника и с каких пор идёт просрочка. */
const describe = (debtor: DebtorView): string =>
  [debtor.apartmentNumber === undefined ? '' : `кв. ${debtor.apartmentNumber}`, debtor.months]
    .filter(Boolean)
    .join(' · ');

/** Строка должника: раскрывается в напоминание. */
const DebtorRow = ({
  api,
  debtor,
  expanded,
  onToggle,
}: {
  api: DomovoyApi;
  debtor: DebtorView;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const haptics = useHaptics();

  const remind = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await api.remindDebtor(debtor.residentId);
      haptics.done();
      setSent(true);
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : 'Напоминание не ушло');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CellSimple
        className={expanded ? 'row-open' : ''}
        title={debtor.displayName}
        subtitle={describe(debtor)}
        after={
          <span className={debtor.overdueDays >= 90 ? 'report-value overdue' : 'report-value'}>
            {rubles(debtor.debt + debtor.penalty)}
          </span>
        }
        showChevron
        separator
        onClick={onToggle}
      />

      {expanded ? (
        <>
          <CellSimple
            title="Начислено, не оплачено"
            after={<span className="report-value">{rubles(debtor.debt)}</span>}
            separator
            height="compact"
          />

          {debtor.penalty > 0 ? (
            <CellSimple
              title="Пени за просрочку"
              subtitle={`просрочка ${plural(debtor.overdueDays, 'день', 'дня', 'дней')}`}
              after={<span className="report-value overdue">{rubles(debtor.penalty)}</span>}
              separator
              height="compact"
            />
          ) : null}

          <CellAction mode={sent ? 'secondary' : 'primary'} disabled={busy || sent} onClick={() => void remind()}>
            {sent ? 'Напомнили' : busy ? 'Отправляем…' : 'Напомнить'}
          </CellAction>
        </>
      ) : null}

      {error ? <ErrorText className="inset">{error}</ErrorText> : null}
    </>
  );
};

/** Долги дома: крупные должники сверху. */
export const DebtorsScreen = ({ api }: DebtorsScreenProps) => {
  const debt = useBridgeRequest((alive) => api.until(alive).debtors(), [api]);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (debt.loading && !debt.data) return <Skeleton count={3} />;

  if (debt.error || !debt.data) {
    return <Failure title="Долги не загрузились" error={debt.error} onRetry={debt.reload} />;
  }

  const list = debt.data.debtors;

  if (list.length === 0) {
    return <Empty icon={<IconRuble />} title="Долгов нет" />;
  }

  return (
    <div className="list">
      <section className="block">
        <p className="amount">
          {money(debt.data.total + debt.data.penalty)}
          <span className="currency">₽</span>
        </p>
        <p className="hint">
          {plural(list.length, 'должник', 'должника', 'должников')}
          {debt.data.penalty > 0 ? ` · в том числе пени ${rubles(debt.data.penalty)}` : ''}
        </p>
      </section>

      <Group>
        {list.map((debtor) => (
          <DebtorRow
            key={debtor.residentId}
            api={api}
            debtor={debtor}
            expanded={expanded === debtor.residentId}
            onToggle={() => setExpanded(expanded === debtor.residentId ? null : debtor.residentId)}
          />
        ))}
      </Group>
    </div>
  );
};
