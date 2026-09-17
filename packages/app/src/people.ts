import { type Resident } from './repository.js';
import { type AppDeps } from './use-cases.js';

export type ReadResident = (residentId: string) => Promise<Resident | undefined>;

/** Чтение людей с памятью на время одного прохода. */
export const rememberResidents = (deps: AppDeps): ReadResident => {
  const known = new Map<string, Resident | undefined>();

  return async (residentId) => {
    if (!known.has(residentId)) known.set(residentId, await deps.repository.findResident(residentId));

    return known.get(residentId);
  };
};
