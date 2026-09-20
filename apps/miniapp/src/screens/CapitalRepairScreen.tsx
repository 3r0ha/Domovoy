import { CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import type { Translate } from '@domovoy/i18n';

import { type DomovoyApi } from '../api.js';
import { useT } from '../i18n.js';
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

const states = (t: Translate): Record<string, string> => ({
  planned: t('capital.state.planned'),
  running: t('capital.state.running'),
  done: t('capital.state.done'),
});

const TONE: Record<string, string> = {
  planned: 'dot',
  running: 'dot dot-work',
  done: 'dot dot-good',
};

const funds = (t: Translate): Record<string, string> => ({
  regional: t('capital.fund.regional'),
  own: t('capital.fund.own'),
});

/** Капитальный ремонт дома: что и в каком году делают по программе. */
export const CapitalRepairScreen = ({ api }: CapitalRepairScreenProps) => {
  const t = useT();
  const plan = useBridgeRequest((alive) => api.until(alive).capitalRepair(), [api]);

  if (plan.loading && !plan.data) return <Skeleton count={3} />;

  if (plan.error || !plan.data) {
    return <Failure title={t('capital.failure')} error={plan.error} onRetry={plan.reload} />;
  }

  const works = plan.data.works;

  if (works.length === 0) {
    return <Empty icon={<IconRepair />} title={t('capital.empty')} hint={t('capital.empty.hint')} />;
  }

  const state = states(t);

  return (
    <div className="list">
      <Group>
        {plan.data.contribution === undefined ? null : (
          <CellSimple
            title={t('capital.contribution')}
            subtitle={t('capital.contribution.unit')}
            after={<span className="report-value">{money(plan.data.contribution)}</span>}
            height="compact"
          />
        )}

        {plan.data.balance === undefined ? null : (
          <CellSimple
            title={t('capital.balance')}
            after={<span className="report-value">{money(plan.data.balance)} ₽</span>}
            separator
            height="compact"
          />
        )}

        {plan.data.fund ? (
          <CellSimple title={funds(t)[plan.data.fund] ?? t('capital.fund.unknown')} separator height="compact" />
        ) : null}
      </Group>

      <Group title={t('capital.works')}>
        <CellList mode="island">
          {works.map((work, index) => (
            <CellSimple
              key={`${work.title}-${work.year}`}
              title={work.title}
              {...(work.note ? { subtitle: work.note } : {})}
              after={
                <span className="row-state">
                  <span className={TONE[work.state] ?? 'dot'} />
                  {work.year}, {state[work.state] ?? work.state}
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
          {plan.data.model ? t('capital.model') : ''}
        </p>
      ) : null}
    </div>
  );
};
