import { Button, CellAction, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import {
  ApiError,
  formatDay,
  money,
  monthName,
  rubles,
  type ChargesView,
  type DomovoyApi,
  type PaymentView,
} from '../api.js';
import { useHaptics } from '../haptics.js';
import { useToast } from '../toast.js';
import { Confirm } from './Confirm.js';
import { ErrorText } from './ErrorText.js';
import { Retry } from './Retry.js';

export interface ChargesCardProps {
  api: DomovoyApi;
  /** Показания могли только что измениться, начисление пересчитывается. */
  version: number;
  /** Подключён ли платёжный шлюз: без него остаются только суммы. */
  payable?: boolean;
  /** Шлюз модельный: платёж никуда не уходит, и это видно человеку. */
  model?: boolean;
}

/** Что именно оплачивают: месяц или накопившийся долг. */
type Asked = { kind: 'month' | 'debt'; amount: number };

/** Меньше копейки к оплате не осталось: такой остаток показывается нулём. */
const owed = (bill: ChargesView): number => Math.max(0, Math.round((bill.total - bill.paid) * 100) / 100);

/** Начисление за месяц. */
export const ChargesCard = ({ api, version, payable = true, model }: ChargesCardProps) => {
  const charges = useBridgeRequest((alive): Promise<ChargesView> => api.until(alive).charges(), [api, version]);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [open, setOpen] = useState(false);
  const [paid, setPaid] = useState(0);
  const haptics = useHaptics();
  const say = useToast();

  const bill = charges.data;

  // Пустой счёт и несостоявшийся запрос выглядят одинаково, если про отказ молчать.
  if (!bill && charges.error) {
    return <Retry title="Счёт не загрузился" error={charges.error} onRetry={charges.reload} />;
  }

  if (!Array.isArray(bill?.lines) || bill.lines.length === 0) return null;

  const left = owed(bill);
  const debt = (bill.debt ?? 0) + (bill.penalty ?? 0);

  const run = async (what: () => Promise<unknown>): Promise<void> => {
    setPaying(true);
    setError(null);

    try {
      await what();
      haptics.done();
      charges.reload();
      setPaid((count) => count + 1);
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : 'Оплата не прошла');
    } finally {
      setPaying(false);
      setAsked(null);
    }
  };

  const pay = (): Promise<void> =>
    run(async () => {
      const receipt = await api.payCharges();

      say(`Оплачено ${rubles(receipt.amount)}`);
    });

  const payDebt = (): Promise<void> =>
    run(async () => {
      const result = await api.payDebt();

      say(`Долг погашен: ${rubles(result.paid)}`);
    });

  return (
    <>
      <section className="block">
        {/* Ключ по числу платежей: после оплаты сумма появляется заново, и это заметно. */}
        <p className="amount" key={paid}>
          {left > 0 ? (
            <>
              {`${money(left)}\u{a0}`}
              <span className="currency">₽</span>
            </>
          ) : (
            'Оплачено'
          )}
        </p>

        {/* Долг называет своя строка ниже: в подписи к сумме месяца он только путает. */}
        <p className="hint">
          {left > 0 ? `за ${period(bill.period)}, до ${bill.dueDay} числа` : `за ${period(bill.period)}`}
        </p>

        {left > 0 && payable ? (
          <Button
            type="button"
            stretched
            size="large"
            disabled={paying}
            onClick={() => setAsked({ kind: 'month', amount: left })}
          >
            {paying ? 'Платим…' : 'Оплатить'}
          </Button>
        ) : null}

        {payable && model ? (
          <p className="hint aside">Оплата показана для примера: деньги со счёта не спишутся</p>
        ) : null}

        {(bill.bases ?? []).map((basis) => (
          <p key={basis} className="hint aside">
            {basis}
          </p>
        ))}

        {error ? <ErrorText>{error}</ErrorText> : null}
      </section>

      {bill.debt ? (
        <CellList mode="island">
          <CellSimple
            className="row-split"
            title="Долг за прошлые месяцы"
            {...(bill.debtFor ? { subtitle: bill.debtFor } : {})}
            after={<span className="report-value">{rubles(bill.debt)}</span>}
            separator={false}
          />

          {bill.penalty ? (
            <CellSimple
              className="row-split"
              title="Пени за просрочку"
              after={<span className="report-value overdue">{rubles(bill.penalty)}</span>}
              separator
              height="compact"
            />
          ) : null}

          {payable ? (
            <CellAction
              className="row-split"
              mode="primary"
              disabled={paying}
              onClick={() => setAsked({ kind: 'debt', amount: debt })}
            >
              {paying ? 'Платим…' : `Погасить ${rubles(debt)}`}
            </CellAction>
          ) : null}
        </CellList>
      ) : null}

      <CellList mode="island">
        <CellSimple
          className={open ? 'row-open' : ''}
          title="Из чего сложилось"
          showChevron
          onClick={() => setOpen(!open)}
          height="compact"
        />
        {open
          ? bill.lines.map((line) => (
              <CellSimple
                key={line.title}
                title={line.title}
                subtitle={line.detail}
                after={<span className="report-value">{rubles(line.amount)}</span>}
                separator
                height="compact"
              />
            ))
          : null}
      </CellList>

      <Payments api={api} version={version + paid} />

      {/* Деньги уходят со счёта необратимо: сумму человек видит до касания, а не после. */}
      {asked ? (
        <Confirm
          title={`Оплатить ${rubles(asked.amount)}?`}
          text={
            asked.kind === 'debt'
              ? 'Спишем долг за прошлые месяцы вместе с пенями.'
              : `Спишем начисление за ${period(bill.period)}.`
          }
          confirmLabel="Оплатить"
          busy={paying}
          busyLabel="Платим…"
          onConfirm={() => void (asked.kind === 'debt' ? payDebt() : pay())}
          onCancel={() => setAsked(null)}
        />
      ) : null}
    </>
  );
};

/** История платежей по квартире. */
const Payments = ({ api, version }: { api: DomovoyApi; version: number }) => {
  const paid = useBridgeRequest((alive): Promise<PaymentView[]> => api.until(alive).payments(), [api, version]);
  const [open, setOpen] = useState(false);

  const list = Array.isArray(paid.data) ? paid.data : [];

  if (list.length === 0 && paid.error) {
    return <Retry title="Платежи не загрузились" error={paid.error} onRetry={paid.reload} />;
  }

  if (list.length === 0) return null;

  return (
    <CellList mode="island">
      <CellSimple
        className={open ? 'row-open' : ''}
        title="Что уже заплачено"
        showChevron
        onClick={() => setOpen(!open)}
        height="compact"
      />

      {open
        ? list.map((payment) => (
            <CellSimple
              key={`${payment.period}-${payment.at}`}
              title={payment.periodTitle}
              subtitle={formatDay(payment.at)}
              after={<span className="report-value">{rubles(payment.amount)}</span>}
              separator
              height="compact"
            />
          ))
        : null}
    </CellList>
  );
};

/** Месяц периода словами: период приходит строкой вида «2026-09». */
const period = (value: string): string => monthName(Number(value.slice(5)) - 1) || value;
