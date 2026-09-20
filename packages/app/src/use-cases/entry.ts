import { audienceForTarget, decodeTarget, describeAudience, describeTarget } from '@domovoy/domain';
import type { Translate } from '@domovoy/i18n';

import { speakDefault } from '../language.js';
import { type Resident } from '../repository.js';
import { type AppDeps } from './deps.js';
import { withReadableAddress } from './requests.js';

/**
 * Только что пришедший человек. Дом ему не подставляется: он появляется вместе
 * с квартирой по коду из квитанции. Дом известен только у пришедшего из чата дома.
 */
export const ensureResident = async (
  deps: AppDeps,
  input: { maxUserId: number; displayName: string; /** Дом, из чата которого пришёл человек. */ buildingId?: string },
): Promise<Resident> => {
  const existing = await deps.repository.findResidentByMaxUserId(input.maxUserId);
  if (existing) return existing;

  const resident: Resident = {
    id: deps.createId(),
    maxUserId: input.maxUserId,
    displayName: input.displayName,
    role: 'resident',
    ...(input.buildingId ? { buildingId: input.buildingId } : {}),
  };

  return deps.repository.saveResident(resident);
};

export interface ContextDescription {
  target: string;
  audience: string | null;
  buildingId: string | null;
}

/** Что означает код с наклейки: показывается жильцу до создания заявки. */
export const describeContext = async (
  deps: AppDeps,
  startParam: string,
  t: Translate = speakDefault(),
): Promise<ContextDescription | null> => {
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
    target: describeTarget(await withReadableAddress(deps, target, apartment), undefined, t),
    audience: audience ? describeAudience(audience, t) : null,
    buildingId: target.kind === 'apartment' ? (apartment?.buildingId ?? null) : target.buildingId,
  };
};
