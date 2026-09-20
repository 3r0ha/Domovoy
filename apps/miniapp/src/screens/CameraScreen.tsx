import { Button } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import { formatTime, type DeviceView, type DomovoyApi } from '../api.js';
import { useT } from '../i18n.js';
import { Failure } from './Failure.js';
import { Skeleton } from './Skeleton.js';

export interface CameraScreenProps {
  api: DomovoyApi;
  device: DeviceView;
}

/** Камера отдельным экраном: кадр занимает его целиком. */
export const CameraScreen = ({ api, device }: CameraScreenProps) => {
  const t = useT();
  const shot = useBridgeRequest((alive) => api.until(alive).deviceSnapshot(device.id), [api, device.id]);

  if (shot.loading && !shot.data) return <Skeleton count={1} />;

  if (shot.error || !shot.data) {
    return <Failure title={t('camera.failure')} error={shot.error} onRetry={shot.reload} />;
  }

  return (
    <section className="block">
      <img className="frame" src={shot.data.image} alt={device.title} />

      <p className="hint">{t('camera.at', { время: formatTime(shot.data.at) })}</p>

      <Button type="button" stretched variant="secondary" disabled={shot.loading} onClick={shot.reload}>
        {shot.loading ? t('camera.refreshing') : t('camera.refresh')}
      </Button>
    </section>
  );
};
