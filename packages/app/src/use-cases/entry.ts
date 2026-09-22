import { audienceForTarget, decodeTarget, describeAudience, describeTarget, targetName } from '@domovoy/domain';
import type { Translate } from '@domovoy/i18n';

import { speakDefault } from '../language.js';
import { translateForReading } from '../machine-translation.js';
import { type Resident } from '../repository.js';
import { type AppDeps } from './deps.js';
import { withReadableAddress } from './requests.js';

/** Как зовут того, чьего имени платформа не назвала. */
export const ANONYMOUS_NAME = 'Жилец';

/**
 * Имя из платформы: человек мог сменить его у себя, и смена увидит новое.
 * Своё имя, заданное в продукте, платформой не перебивается: человек назвал
 * себя сам, и возвращать ему никнейм из профиля незачем. Имя обезличенного
 * профиля тоже не восстанавливается.
 */
const withFreshName = async (deps: AppDeps, resident: Resident, displayName: string): Promise<Resident> => {
  const fresh = displayName.trim();

  if (resident.nameByUser || resident.forgottenAt || !fresh || fresh === resident.displayName) return resident;

  return deps.repository.saveResident({ ...resident, displayName: fresh });
};

/**
 * Только что пришедший человек. Дом ему не подставляется: он появляется вместе
 * с квартирой по коду из квитанции. Дом известен только у пришедшего из чата дома.
 * Пустое имя означает, что платформа его не назвала: тогда прежнее имя остаётся.
 */
export const ensureResident = async (
  deps: AppDeps,
  input: { maxUserId: number; displayName: string; /** Дом, из чата которого пришёл человек. */ buildingId?: string },
): Promise<Resident> => {
  const existing = await deps.repository.findResidentByMaxUserId(input.maxUserId);

  if (existing) return withFreshName(deps, existing, input.displayName);

  const resident: Resident = {
    id: deps.createId(),
    maxUserId: input.maxUserId,
    displayName: input.displayName.trim() || ANONYMOUS_NAME,
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
  viewer?: Resident,
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
  const located = await withReadableAddress(deps, target, apartment);
  // Название оборудования ведётся в справочнике дома по-русски: жильцу
  // с другим языком его переводит служба.
  const machine = await translateForReading(deps, viewer, [targetName(located)]);

  return {
    target: machine.of(describeTarget(located, undefined, t)),
    audience: audience ? describeAudience(audience, t) : null,
    buildingId: target.kind === 'apartment' ? (apartment?.buildingId ?? null) : target.buildingId,
  };
};
