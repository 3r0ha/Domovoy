import { Button, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, formatPublished, formatTime, type DeviceView, type DomovoyApi } from '../api.js';
import { useHaptics } from '../haptics.js';
import { DoorRow } from './DoorRow.js';
import { Empty } from './Empty.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconCamera, IconKey, IconQueue, IconScan, IconWarning } from './icons.js';
import { useCodeScanner } from './ScanCode.js';
import { Skeleton } from './Skeleton.js';

export interface HomeScreenProps {
  api: DomovoyApi;
  staff?: boolean;
  /** Подключение домофонии модельное: человеку это видно строкой. */
  model?: boolean;
  onCamera: (device: DeviceView) => void;
  onGuest: (device: DeviceView) => void;
  onJournal: () => void;
  /** Прочитать наклейку с кодом объекта. */
  onScan: (startParam: string) => void;
}

/** Дверь жильца: открытие и выдача гостевого кода. */
const Door = ({ api, device, onGuest }: { api: DomovoyApi; device: DeviceView; onGuest: () => void }) => (
  <CellList mode="island">
    <DoorRow api={api} device={device} separator={false} />
    <CellSimple className="row-under" title="Код гостю" showChevron separator onClick={onGuest} />
  </CellList>
);

/** Наклейка на оборудовании: строка списка, как и всё остальное на этом экране. */
const ScanRow = ({ onScanned }: { onScanned: (startParam: string) => void }) => {
  const scanner = useCodeScanner(onScanned);

  if (!scanner.supported) return null;

  return (
    <Group>
      <CellSimple
        before={
          <span className="tile tile-grey">
            <IconScan />
          </span>
        }
        title="Сканировать код"
        showChevron
        onClick={scanner.scan}
      />
      {scanner.error ? <ErrorText className="inset">{scanner.error}</ErrorText> : null}
    </Group>
  );
};

/** Выданные коды: их видно и после выдачи, отозвать можно в любой момент. */
const GuestCodes = ({ api, devices }: { api: DomovoyApi; devices: readonly DeviceView[] }) => {
  const codes = useBridgeRequest(() => api.guestCodes(), [api]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const haptics = useHaptics();

  const list = codes.data ?? [];

  // Молча пропадать нельзя: человек выдавал код и ищет его здесь.
  if (codes.error) return <ErrorText>Гостевые коды не загрузились</ErrorText>;
  if (list.length === 0) return null;

  const revoke = async (code: string): Promise<void> => {
    setBusy(code);
    setError(null);

    try {
      await api.revokeGuestCode(code);
      haptics.done();
      codes.reload();
    } catch (reason: unknown) {
      haptics.failed();
      setError(describeFailure(reason));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Group title="Гостевые коды">
      {list.map((code, index) => (
        <CellSimple
          key={code.code}
          before={
            <span className="tile tile-teal">
              <IconKey />
            </span>
          }
          title={code.code}
          subtitle={`${devices.find((device) => device.id === code.deviceId)?.title ?? 'Дверь'} · до ${formatTime(code.expiresAt)}`}
          separator={index > 0}
          after={
            <Button
              type="button"
              size="small"
              variant="secondary"
              disabled={busy === code.code}
              onClick={() => void revoke(code.code)}
            >
              {busy === code.code ? '…' : 'Отозвать'}
            </Button>
          }
        />
      ))}

      {error ? <ErrorText className="inset">{error}</ErrorText> : null}
    </Group>
  );
};

/** Датчики и время последней связи. */
const Sensors = ({ api }: { api: DomovoyApi }) => {
  const sensors = useBridgeRequest(() => api.sensors(), [api]);
  const list = sensors.data ?? [];

  if (sensors.error) return <ErrorText>Датчики не загрузились</ErrorText>;
  if (list.length === 0) return null;

  return (
    <Group>
      {list.map((sensor, index) => (
        <CellSimple
          key={sensor.id}
          before={
            <span className={sensor.silent ? 'tile tile-red' : 'tile tile-green'}>
              <IconWarning />
            </span>
          }
          title={sensor.title}
          subtitle={
            sensor.silent
              ? 'не выходит на связь'
              : sensor.lastSeenAt
                ? `на связи · ${formatPublished(sensor.lastSeenAt)}`
                : 'на связи'
          }
          separator={index > 0}
        />
      ))}
    </Group>
  );
};

/** Дом: двери, камеры и журнал открытий. */
export const HomeScreen = ({ api, staff, model, onCamera, onGuest, onJournal, onScan }: HomeScreenProps) => {
  const devices = useBridgeRequest(() => api.devices(), [api]);

  if (devices.loading && !devices.data) return <Skeleton count={2} />;

  if (devices.error) {
    return <Failure title="Оборудование недоступно" error={devices.error} onRetry={devices.reload} />;
  }

  const all = devices.data ?? [];
  const doors = all.filter((device) => device.kind !== 'camera');
  const cameras = all.filter((device) => device.kind === 'camera');

  if (all.length === 0) {
    return (
      <Empty
        icon={<IconKey />}
        title="Оборудования нет"
        hint="Домофон и камеры не подключены"
      />
    );
  }

  return (
    <div className="list">
      {model ? <p className="hint aside">Домофония работает на модельном подключении: оборудования за ним нет</p> : null}

      {staff ? (
        <Group>
          {doors.map((device, index) => (
            <DoorRow key={device.id} api={api} device={device} separator={index > 0} />
          ))}
        </Group>
      ) : (
        doors.map((device) => <Door key={device.id} api={api} device={device} onGuest={() => onGuest(device)} />)
      )}

      {cameras.length > 0 ? (
        <Group>
          {cameras.map((device, index) => (
            <CellSimple
              key={device.id}
              before={
                <span className="tile tile-blue">
                  <IconCamera />
                </span>
              }
              title={device.title}
              showChevron
              separator={index > 0}
              onClick={() => onCamera(device)}
            />
          ))}
        </Group>
      ) : null}

      {staff ? <Sensors api={api} /> : <GuestCodes api={api} devices={doors} />}

      {staff ? (
        <Group>
          <CellSimple
            before={
              <span className="tile tile-grey">
                <IconQueue />
              </span>
            }
            title="Журнал открытий"
            showChevron
            onClick={onJournal}
          />
        </Group>
      ) : null}

      <ScanRow onScanned={onScan} />
    </div>
  );
};
