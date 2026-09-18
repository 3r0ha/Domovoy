import type { Apartment } from '@domovoy/domain';

import type { Building, Repository, Resident } from './repository.js';

/** Одно чтение на ключ: повторный вызов получает тот же незавершённый промис. */
const once = <T>(cache: Map<string, Promise<T>>, key: string, read: () => Promise<T>): Promise<T> => {
  const ready = cache.get(key);

  if (ready) return ready;

  const started = read();

  cache.set(key, started);
  // Неудачное чтение не запоминается: следующий вызов пробует снова.
  started.catch(() => cache.delete(key));

  return started;
};

/**
 * Репозиторий с кэшем справочных чтений на время одного сценария. Дом, квартира
 * и смена внутри вызова не меняются, а спрашивают их разные части сценария
 * по многу раз. Всё остальное уходит в исходный репозиторий без изменений,
 * поэтому обёртку нельзя оставлять жить дольше одного вызова.
 */
export const withReadCache = (repository: Repository): Repository => {
  const apartments = new Map<string, Promise<Apartment | undefined>>();
  const buildings = new Map<string, Promise<Building | undefined>>();
  const lists = new Map<string, Promise<Apartment[]>>();
  const staff = new Map<string, Promise<Resident[]>>();

  const cached = Object.create(repository) as Repository;

  cached.findApartment = (apartmentId) =>
    once(apartments, apartmentId, () => repository.findApartment(apartmentId));

  cached.findBuilding = (buildingId) => once(buildings, buildingId, () => repository.findBuilding(buildingId));

  cached.listApartments = (buildingId) => once(lists, buildingId, () => repository.listApartments(buildingId));

  cached.listStaff = (buildingId) => once(staff, buildingId, () => repository.listStaff(buildingId));

  return cached;
};
