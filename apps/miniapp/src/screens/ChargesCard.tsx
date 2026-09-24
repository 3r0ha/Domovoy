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
import { useT } from '../i18n.js';
import { useToast } from '../toast.js';
import { Money } from './Amount.js';
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
  const [part, setPart] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [open, setOpen] = useState(false);
  const [paid, setPaid] = useState(0);
  const haptics = useHaptics();
  const say = useToast();
  const t = useT();

  const bill = charges.data;

  // Пустой счёт и несостоявшийся запрос выглядят одинаково, если про отказ молчать.
  if (!bill && charges.error) {
    return <Retry title={t('charges.failure')} error={charges.error} onRetry={charges.reload} />;
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
      setError(reason instanceof ApiError ? reason.message : t('charges.pay.failed'));
    } finally {
      setPaying(false);
      setAsked(null);
    }
  };

  const pay = (amount?: number): Promise<void> =>
    run(async () => {
      const receipt = await api.payCharges(amount);

      say(t('charges.paid', { сумма: rubles(receipt.amount) }));
    });

  /** Сумма частичного платежа: пустое поле означает «весь остаток». */
  const partial = (): number | undefined => {
    const typed = Number(part.replace(',', '.'));

    return part.trim() && Number.isFinite(typed) && typed > 0 ? typed : undefined;
  };

  const payDebt = (): Promise<void> =>
    run(async () => {
      const result = await api.payDebt();

      say(t('charges.debt.paid', { сумма: rubles(result.paid) }));
    });

  return (
    <>
      <section className="block">
        {/* Ключ по числу платежей: после оплаты сумма появляется заново, и это заметно. */}
        <p className="amount" key={paid}>
          {left > 0 ? (
            <>
              {money(left)}
              <span className="currency">₽</span>
            </>
          ) : (
            t('charges.settled')
          )}
        </p>

        {/* Долг называет своя строка ниже: в подписи к сумме месяца он только путает. */}
        <p className="hint">
          {left > 0
            ? t('charges.due', { месяц: period(bill.period), день: bill.dueDay })
            : t('charges.period', { месяц: period(bill.period) })}
        </p>

        {left > 0 && payable ? (
          <>
            <Button
              type="button"
              stretched
              size="large"
              disabled={paying}
              onClick={() => setAsked({ kind: 'month', amount: partial() ?? left })}
            >
              {/* Кнопка называет сумму: при частичном платеже иначе не видно,
                  спишут введённое или весь остаток. */}
              {paying ? t('charges.paying') : `${t('charges.pay')} ${rubles(partial() ?? left)}`}
            </Button>

            {/* Денег бывает не на весь счёт: частичный платёж лучше
                неоплаченного счёта, и пени тогда идут на остаток. */}
            {/* Подпись внутри поля: отдельной строкой слева она оставляла
                рядом пустую коробку, а сумма к списанию теперь на кнопке. */}
            <input
              className="part"
              type="text"
              inputMode="decimal"
              aria-label={t('charges.part')}
              placeholder={t('charges.part')}
              value={part}
              onChange={(event) => setPart(event.target.value)}
            />
          </>
        ) : null}

        {payable && model ? <p className="hint aside">{t('charges.model')}</p> : null}

        {error ? <ErrorText>{error}</ErrorText> : null}
      </section>

      {bill.debt ? (
        <CellList mode="island">
          <CellSimple
            className="row-split"
            title={t('charges.debt')}
            {...(bill.debtFor ? { subtitle: bill.debtFor } : {})}
            after={<Money amount={bill.debt} />}
            separator={false}
          />

          {bill.penalty ? (
            <CellSimple
              className="row-split"
              title={t('charges.penalty')}
              after={<Money amount={bill.penalty} className="overdue" />}
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
              {paying ? t('charges.paying') : t('charges.debt.pay', { сумма: rubles(debt) })}
            </CellAction>
          ) : null}
        </CellList>
      ) : null}

      <CellList mode="island">
        <CellSimple
          className={open ? 'row-open' : ''}
          title={t('charges.lines')}
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
                after={<Money amount={line.amount} />}
                separator
                height="compact"
              />
            ))
          : null}
      </CellList>

      {/* Основания расчёта лежат под разбором, а не под суммой: там они были
          стопкой серых абзацев поверх главного числа экрана. */}
      {open && (bill.bases ?? []).length > 0 ? (
        <div className="bases">
          {(bill.bases ?? []).map((basis) => (
            <p key={basis} className="hint">
              {basis}
            </p>
          ))}
        </div>
      ) : null}

      <Payments api={api} version={version + paid} />

      {/* Деньги уходят со счёта необратимо: сумму человек видит до касания, а не после. */}
      {asked ? (
        <Confirm
          title={t('charges.confirm', { сумма: rubles(asked.amount) })}
          text={
            asked.kind === 'debt'
              ? t('charges.confirm.debt')
              : t('charges.confirm.month', { месяц: period(bill.period) })
          }
          confirmLabel={t('charges.pay')}
          busy={paying}
          busyLabel={t('charges.paying')}
          error={error}
          onConfirm={() => void (asked.kind === 'debt' ? payDebt() : pay(partial()))}
          onCancel={() => setAsked(null)}
        />
      ) : null}
    </>
  );
};

/** История платежей по квартире. */
const Payments = ({ api, version }: { api: DomovoyApi; version: number }) => {
  const t = useT();
  const paid = useBridgeRequest((alive): Promise<PaymentView[]> => api.until(alive).payments(), [api, version]);
  const [open, setOpen] = useState(false);

  const list = Array.isArray(paid.data) ? paid.data : [];

  if (list.length === 0 && paid.error) {
    return <Retry title={t('charges.payments.failure')} error={paid.error} onRetry={paid.reload} />;
  }

  if (list.length === 0) return null;

  return (
    <CellList mode="island">
      <CellSimple
        className={open ? 'row-open' : ''}
        title={t('charges.payments')}
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
              after={<Money amount={payment.amount} />}
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
