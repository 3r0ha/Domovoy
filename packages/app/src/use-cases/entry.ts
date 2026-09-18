import { audienceForTarget, decodeTarget, describeAudience, describeTarget } from '@domovoy/domain';

import { type Resident } from '../repository.js';
import { type AppDeps } from './deps.js';
import { withReadableAddress } from './requests.js';

/** Дом для только что пришедшего человека. */
const buildingForNewcomer = async (deps: AppDeps): Promise<string | undefined> => {
  if (deps.defaultBuildingId) {
    const configured = await deps.repository.findBuilding(deps.defaultBuildingId);

    if (configured) return configured.id;
  }

  const buildings = await deps.repository.listBuildings();

  return buildings.length === 1 ? buildings[0]?.id : undefined;
};

export const ensureResident = async (
  deps: AppDeps,
  input: { maxUserId: number; displayName: string; /** Дом, из чата которого пришёл человек. */ buildingId?: string },
): Promise<Resident> => {
  const existing = await deps.repository.findResidentByMaxUserId(input.maxUserId);
  if (existing) return existing;

  const buildingId = input.buildingId ?? (await buildingForNewcomer(deps));

  const resident: Resident = {
    id: deps.createId(),
    maxUserId: input.maxUserId,
    displayName: input.displayName,
    role: 'resident',
    ...(buildingId ? { buildingId } : {}),
  };

  return deps.repository.saveResident(resident);
};

export interface ContextDescription {
  target: string;
  audience: string | null;
  buildingId: string | null;
}

/** Что означает код с наклейки: показывается жильцу до создания заявки. */
export const describeContext = async (deps: AppDeps, startParam: string): Promise<ContextDescription | null> => {
  const target = decodeTarget(startParam);
  if (!target) return null;

  const apartment = target.kind === 'apartment' ? await deps.repository.findApartment(target.apartmentId) : undefined;

  // Код с наклейки может быть набран с ошибкой или остаться от снятого объекта:
  // обращение по несуществующему месту заводить нельзя.
  if (target.kind === 'apartment' && !apartment) return null;

  if (target.kind === 'equipment') {
    const known = await deps.repository.findEquipment(target.buildingId, target.equipmentId);

    if (!known) return null;
  }

  const audience = audienceForTarget(target);

  return {
    target: describeTarget(await withReadableAddress(deps, target, apartment)),
    audience: audience ? describeAudience(audience) : null,
    buildingId: target.kind === 'apartment' ? (apartment?.buildingId ?? null) : target.buildingId,
  };
};
