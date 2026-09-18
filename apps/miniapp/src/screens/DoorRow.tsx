import { Button, CellSimple } from '@maxhub/max-ui';
import { useEffect, useState } from 'react';

import { ApiError, type DeviceView, type DomovoyApi } from '../api.js';
import { useHaptics } from '../haptics.js';
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
      setError(reason instanceof ApiError ? reason.message : 'Дверь не ответила');
    }
  };

  return { state, left, error, open: () => void open() };
};

/** Что написано на кнопке: покой, ожидание ответа или сколько осталось открыто. */
const lockLabel = (state: OpenState, left: number): string =>
  state === 'opening' ? 'Открываем…' : state === 'open' ? `Открыто, ${left} с` : 'Открыть';

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
  const lock = useLock(api, device);

  return (
    <CellSimple
      className="row-split"
      before={
        <span className="tile tile-teal">
          <IconKey />
        </span>
      }
      title={device.title}
      {...(lock.error ? { subtitle: <span className="error">{lock.error}</span> } : {})}
      after={
        <Button
          type="button"
          size="small"
          className="steady"
          aria-label={`Открыть: ${device.title}`}
          disabled={lock.state === 'opening'}
          onClick={lock.open}
        >
          {lockLabel(lock.state, lock.left)}
        </Button>
      }
      separator={separator}
    />
  );
};
