import { DEFAULT_TIME_ZONE, MOSCOW_TIME_NOTE, formatMoment } from '@domovoy/domain';

import type { AppDeps } from './use-cases.js';

/** Часовой пояс дома. */
export const zoneOf = async (deps: AppDeps, buildingId: string | undefined): Promise<string> => {
  if (!buildingId) return DEFAULT_TIME_ZONE;

  const building = await deps.repository.findBuilding(buildingId);

  return building?.timeZone ?? DEFAULT_TIME_ZONE;
};

/** Пояс дома, если он задан в карточке. Без него время в текстах московское. */
export const houseZone = async (deps: AppDeps, buildingId: string | undefined): Promise<string | undefined> => {
  if (!buildingId) return undefined;

  return (await deps.repository.findBuilding(buildingId))?.timeZone;
};

/** Момент словами в поясе дома. Без пояса в карточке время подписано московским. */
export const formatMomentAt = (at: Date, zone: string | undefined): string =>
  zone ? formatMoment(at, zone) : `${formatMoment(at)} ${MOSCOW_TIME_NOTE}`;
