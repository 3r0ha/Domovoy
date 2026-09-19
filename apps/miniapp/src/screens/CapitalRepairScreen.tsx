import { CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import { type DomovoyApi } from '../api.js';
import { Empty } from './Empty.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconRepair } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface CapitalRepairScreenProps {
  api: DomovoyApi;
}

/** Деньги для человека: две цифры после запятой и разряды пробелами. */
const money = (amount: number): string =>
  amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATES: Record<string, string> = {
  planned: 'по плану',
  running: 'идут работы',
  done: 'сделано',
};

const TONE: Record<string, string> = {
  planned: 'dot',
  running: 'dot dot-work',
  done: 'dot dot-good',
};

const FUNDS: Record<string, string> = {
  regional: 'Взносы идут региональному оператору',
  own: 'Дом копит на своём счёте',
};

/** Капитальный ремонт дома: что и в каком году делают по программе. */
export const CapitalRepairScreen = ({ api }: CapitalRepairScreenProps) => {
  const plan = useBridgeRequest((alive) => api.until(alive).capitalRepair(), [api]);

  if (plan.loading && !plan.data) return <Skeleton count={3} />;

  if (plan.error || !plan.data) {
    return <Failure title="Капитальный ремонт недоступен" error={plan.error} onRetry={plan.reload} />;
  }

  const works = plan.data.works;

  if (works.length === 0) {
    return <Empty icon={<IconRepair />} title="Капремонт не запланирован" hint="Программу ведёт регион" />;
  }

  return (
    <div className="list">
      <Group>
        {plan.data.contribution === undefined ? null : (
          <CellSimple
            title="Взнос за капитальный ремонт"
            subtitle="₽ за м² в месяц"
            after={<span className="report-value">{money(plan.data.contribution)}</span>}
            height="compact"
          />
        )}

        {plan.data.balance === undefined ? null : (
          <CellSimple
            title="Накоплено домом"
            after={<span className="report-value">{money(plan.data.balance)} ₽</span>}
            separator
            height="compact"
          />
        )}

        {plan.data.fund ? (
          <CellSimple title={FUNDS[plan.data.fund] ?? 'Способ накопления не указан'} separator height="compact" />
        ) : null}
      </Group>

      <Group title="Что и когда делают">
        <CellList mode="island">
          {works.map((work, index) => (
            <CellSimple
              key={`${work.title}-${work.year}`}
              title={work.title}
              {...(work.note ? { subtitle: work.note } : {})}
              after={
                <span className="row-state">
                  <span className={TONE[work.state] ?? 'dot'} />
                  {work.year}, {STATES[work.state] ?? work.state}
                </span>
              }
              separator={index > 0}
            />
          ))}
        </CellList>
      </Group>

      {/* Данные не от управляющей организации: у них свой источник и свой порядок правки. */}
      {plan.data.source ? (
        <p className="hint aside">
          {plan.data.source}
          {plan.data.model ? '. Числа показаны для примера: обмена с региональным оператором пока нет' : ''}
        </p>
      ) : null}
    </div>
  );
};
