import { Button, CellSimple } from '@maxhub/max-ui';
import { useEffect, useState } from 'react';

import type { Translate } from '@domovoy/i18n';

import { ApiError, type DeviceView, type DomovoyApi } from '../api.js';
import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
import { ErrorText } from './ErrorText.js';
import { IconKey } from './icons.js';

type OpenState = 'idle' | 'opening' | 'open';

/** Сколько замок держит дверь: столько же на кнопке идёт обратный отсчёт. */
const OPEN_SECONDS = 10;

/** Открытие замка: нажатие, ответ и ошибка. */
const useLock = (
  api: DomovoyApi,
  device: DeviceView,
): { state: OpenState; left: number; error: string | null; open: () => void } => {
  const [state, setState] = useState<OpenState>('idle');
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const haptics = useHaptics();
  const t = useT();

  // Дверь открыта не навсегда: отсчёт идёт на кнопке и сам возвращает её в покой.
  useEffect(() => {
    if (state !== 'open') return undefined;

    const timer = setInterval(() => setLeft((seconds) => Math.max(0, seconds - 1)), 1000);

    return () => clearInterval(timer);
  }, [state]);

  // Отсчёт кончился: кнопка возвращается в покой отдельно от самого отсчёта.
  useEffect(() => {
    if (state === 'open' && left === 0) setState('idle');
  }, [state, left]);

  const open = async (): Promise<void> => {
    setState('opening');
    setError(null);

    try {
      await api.openDevice(device.id);
      haptics.done();
      setLeft(OPEN_SECONDS);
      setState('open');
    } catch (reason) {
      haptics.failed();
      setState('idle');
      setError(reason instanceof ApiError ? reason.message : t('door.failed'));
    }
  };

  return { state, left, error, open: () => void open() };
};

/** Что написано на кнопке: покой, ожидание ответа или сколько осталось открыто. */
const lockLabel = (t: Translate, state: OpenState, left: number): string =>
  state === 'opening' ? t('door.opening') : state === 'open' ? t('door.open', { секунды: left }) : t('door.action');

/** Строка двери: название и кнопка, которой её открывают. */
export const DoorRow = ({
  api,
  device,
  separator,
}: {
  api: DomovoyApi;
  device: DeviceView;
  separator: boolean;
}) => {
  const t = useT();
  const lock = useLock(api, device);

  return (
    <>
      <CellSimple
        className="row-split"
        before={
          <span className="tile tile-teal">
            <IconKey />
          </span>
        }
        title={device.title}
        after={
          <Button
            type="button"
            size="small"
            className="steady"
            aria-label={t('door.label', { дверь: device.title })}
            disabled={lock.state === 'opening'}
            onClick={lock.open}
          >
            {lockLabel(t, lock.state, lock.left)}
          </Button>
        }
        separator={separator}
      />

      {/* Отказ под строкой во всю ширину: рядом с кнопкой ему оставалась узкая колонка. */}
      {lock.error ? <ErrorText className="inset">{lock.error}</ErrorText> : null}
    </>
  );
};
