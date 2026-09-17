import { LEGAL_VERSION } from '@domovoy/domain';

import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Согласился ли человек с действующей редакцией. */
export const legalAccepted = (resident: { legalVersion?: string }): boolean =>
  resident.legalVersion === LEGAL_VERSION;

/** Согласие человека с действующей редакцией документов. */
export const acceptLegal = async (deps: AppDeps, resident: Resident): Promise<Resident> => {
  if (legalAccepted(resident)) return resident;

  return deps.repository.saveResident({ ...resident, legalVersion: LEGAL_VERSION, legalAt: deps.now() });
};
