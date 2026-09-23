import type { AppDeps, Resident } from '@domovoy/app';

import { demoData } from './demo.js';

/**
 * Настоящие люди, то есть все, кроме учёток набора для показа. Пересев обновляет
 * набор, а проверяющий, вернувшись утром, не начинает знакомство с ботом заново.
 */
export const realPeople = async (deps: AppDeps, people?: () => Promise<number[]>): Promise<Resident[]> => {
  if (!people) return [];

  const demo = new Set(demoData().residents.map((resident) => resident.maxUserId));
  const found = await Promise.all(
    (await people()).filter((id) => !demo.has(id)).map((id) => deps.repository.findResidentByMaxUserId(id)),
  );

  return found.filter((resident): resident is Resident => resident !== undefined);
};

/**
 * Люди возвращаются с языком, согласием, ролью и квартирой: идентификаторы
 * квартир в наборе постоянные. Квартиры, заведённой при проверке, после пересева
 * нет, и такой человек возвращается без привязки.
 */
export const restorePeople = async (deps: AppDeps, people: Resident[]): Promise<void> => {
  for (const person of people) {
    try {
      await deps.repository.saveResident(person);
    } catch {
      const unbound: Resident = { ...person, apartmentIds: [] };

      delete unbound.apartmentId;
      delete unbound.buildingId;

      await deps.repository.saveResident(unbound).catch((error: unknown) => {
        console.error(`После пересева не удалось вернуть ${person.id}`, error);
      });
    }
  }
};
