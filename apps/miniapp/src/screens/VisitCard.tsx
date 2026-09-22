import { Button, CellAction, CellList } from '@maxhub/max-ui';
import { useState } from 'react';

import { describeFailure, formatDayAt, type DomovoyApi, type RequestView } from '../api.js';
import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
import { ErrorText } from './ErrorText.js';

/**
 * Согласование визита в квартиру. Работы в квартире требуют, чтобы дома кто-то
 * был: мастер предлагает окна, жилец выбирает одно. Неудачный выезд отмечает
 * смена: срок по заявке за закрытую дверь не идёт.
 */
export const VisitCard = ({
  api,
  request,
  staff,
  onChanged,
}: {
  api: DomovoyApi;
  request: RequestView;
  /** Глазами смены: ей доступны предложение окон и отметка о неудачном выезде. */
  staff?: boolean;
  onChanged: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const haptics = useHaptics();
  const t = useT();

  const slots = request.appointment?.slots ?? [];
  const chosen = request.appointment?.at;
  const missed = request.appointment?.missed ?? 0;

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setFailed(undefined);

    try {
      await action();
      haptics.done();
      onChanged();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(false);
    }
  };

  // Время согласовано: жилец его переносит, смена отмечает неудачный выезд.
  if (chosen) {
    return (
      <section className="block visit">
        <p>{staff ? t('visit.chosenForStaff', { когда: formatDayAt(chosen) }) : t('visit.chosen', { когда: formatDayAt(chosen) })}</p>
        {missed > 0 && staff ? <p className="hint">{t('visit.missedCount', { сколько: missed })}</p> : null}
        {failed ? <ErrorText>{failed}</ErrorText> : null}

        <CellList mode="island">
          {staff ? (
            <CellAction mode="secondary" disabled={busy} onClick={() => void run(() => api.missedVisit(request.id))}>
              {t('visit.missed')}
            </CellAction>
          ) : (
            // Планы меняются: без отмены мастер едет в пустую квартиру, а жилец
            // ничего сделать не может.
            <CellAction mode="secondary" disabled={busy} onClick={() => void run(() => api.dropVisit(request.id))}>
              {t('visit.drop')}
            </CellAction>
          )}
        </CellList>
      </section>
    );
  }

  // Окна предложены. Жилец выбирает из них, а смена видит, что именно ушло
  // жильцу: без этого нажатие «предложить время» выглядит как несработавшее.
  if (slots.length > 0) {
    return (
      <section className="block visit">
        <p>{staff ? t('visit.offered') : t('visit.pick')}</p>
        {failed ? <ErrorText>{failed}</ErrorText> : null}

        <CellList mode="island">
          {slots.map((slot) => (
            <CellAction
              key={slot}
              mode={staff ? 'secondary' : 'primary'}
              disabled={busy || staff}
              onClick={() => void run(() => api.takeVisit(request.id, slot))}
            >
              {formatDayAt(slot)}
            </CellAction>
          ))}
        </CellList>

        {staff ? <p className="hint">{t('visit.waiting')}</p> : null}
      </section>
    );
  }

  if (!staff) return null;

  return (
    <section className="block visit">
      {missed > 0 ? <p className="hint">{t('visit.missedCount', { сколько: missed })}</p> : null}
      {failed ? <ErrorText>{failed}</ErrorText> : null}

      <Button type="button" stretched disabled={busy} onClick={() => void run(() => api.offerVisit(request.id))}>
        {t('visit.offer')}
      </Button>

      <p className="hint">{t('visit.offer.about')}</p>
    </section>
  );
};
