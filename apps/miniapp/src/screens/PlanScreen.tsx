import { useBridgeRequest } from '@maxkit/react';

import { type DomovoyApi, type HousePlanView, type PlanAlertView } from '../api.js';
import { Empty } from './Empty.js';
import { Failure } from './Failure.js';
import { IconHome } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface PlanScreenProps {
  api: DomovoyApi;
  /** Открыть заявку, из-за которой квартира подсвечена. */
  onOpen: (id: string) => void;
}

type Flat = HousePlanView['entrances'][number]['risers'][number]['flats'][number];

const TITLES: Record<Flat['state'], string> = {
  emergency: 'авария',
  open: 'заявка в работе',
  fine: 'у жильца работает',
  quiet: 'тихо',
};

const Cell = ({ flat, onOpen }: { flat: Flat; onOpen: (id: string) => void }) => {
  const label = `Квартира ${flat.number}: ${TITLES[flat.state]}`;
  const id = flat.requestId;

  if (!id) {
    return (
      <span className={`flat flat-${flat.state}`} title={label} aria-label={label}>
        {flat.number}
      </span>
    );
  }

  return (
    <button type="button" className={`flat flat-${flat.state}`} title={label} aria-label={label} onClick={() => onOpen(id)}>
      {flat.number}
    </button>
  );
};

const Alerts = ({ alerts, onOpen }: { alerts: PlanAlertView[]; onOpen: (id: string) => void }) =>
  alerts.map((alert) => (
    <button key={alert.id} type="button" className="now-row now-row-open" onClick={() => onOpen(alert.id)}>
      <span className={alert.emergency ? 'dot dot-bad' : 'dot'} />
      <span>{alert.title}</span>
      <span className="now-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  ));

/** Дом на схеме. */
export const PlanScreen = ({ api, onOpen }: PlanScreenProps) => {
  const plan = useBridgeRequest(() => api.housePlan(), [api]);

  if (plan.loading && !plan.data) return <Skeleton count={2} />;

  if (plan.error || !plan.data) {
    return <Failure title="План не загрузился" error={plan.error} onRetry={plan.reload} />;
  }

  const entrances = plan.data.entrances;
  const house = plan.data.house;

  if (entrances.length === 0) {
    return <Empty icon={<IconHome />} title="Квартир нет" hint="Дом заводится вместе со списком помещений" />;
  }

  return (
    <div className="list">
      {/* Легенда стоит до плана: без неё цвета квартир читать нечем. */}
      <p className="legend hint">
        <span>
          <span className="flat flat-emergency" aria-hidden="true" /> авария
        </span>
        <span>
          <span className="flat flat-open" aria-hidden="true" /> в работе
        </span>
        <span>
          <span className="flat flat-fine" aria-hidden="true" /> работает
        </span>
        <span>
          <span className="flat" aria-hidden="true" /> нет обращений
        </span>
      </p>

      <p className="aside hint">Красная полоса: отказ на стояке</p>

      {entrances.map((entrance) => (
        <section key={entrance.entrance} className="block">
          <h2>Подъезд {entrance.entrance}</h2>

          <p className="hint">Квартиры по стоякам, первый этаж внизу</p>

          <div className="cut">
            {/* Стояк без помещений рисовать нечем: пустая колонка читается как потерянные квартиры. */}
            {entrance.risers
              .filter((riser) => riser.flats.length > 0)
              .map((riser) => (
                <div key={riser.riser} className={riser.alerts.length > 0 ? 'riser pipe pipe-alert' : 'riser pipe'}>
                  <div className="flats">
                    {[...riser.flats].reverse().map((flat) => (
                      <Cell key={flat.number} flat={flat} onOpen={onOpen} />
                    ))}
                  </div>
                  <span className="riser-title">Стояк {riser.riser}</span>
                </div>
              ))}
          </div>

          <Alerts
            alerts={[...entrance.alerts, ...entrance.risers.flatMap((riser) => riser.alerts)]}
            onOpen={onOpen}
          />
        </section>
      ))}

      {house.length > 0 ? (
        <section className="block">
          <h2>Дом и оборудование</h2>
          <Alerts alerts={house} onOpen={onOpen} />
        </section>
      ) : null}

    </div>
  );
};
