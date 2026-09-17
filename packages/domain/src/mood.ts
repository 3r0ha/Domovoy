import { isOverdue } from './sla.js';
import { isConfirmedIncident } from './incident.js';
import { OPEN_STATUSES } from './status.js';
import type { ServiceRequest } from './types.js';

/** Состояние дома одним словом: спокоен, есть просрочка, есть авария. */
export type HouseMood = 'sleeping' | 'walking' | 'alarmed';

/** Состояние дома целиком, по всем его заявкам. */
export const houseMood = (requests: readonly ServiceRequest[], now: Date): HouseMood => {
  const open = requests.filter((request) => OPEN_STATUSES.includes(request.status));

  if (open.some((request) => request.priority === 'emergency' || isConfirmedIncident(request))) return 'alarmed';
  if (open.some((request) => isOverdue(request, now))) return 'walking';

  return 'sleeping';
};
