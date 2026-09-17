import { DEFAULT_TIME_ZONE } from '@domovoy/domain';

import type { AppDeps } from './use-cases.js';

/** Часовой пояс дома. */
export const zoneOf = async (deps: AppDeps, buildingId: string | undefined): Promise<string> => {
  if (!buildingId) return DEFAULT_TIME_ZONE;

  const building = await deps.repository.findBuilding(buildingId);

  return building?.timeZone ?? DEFAULT_TIME_ZONE;
};
