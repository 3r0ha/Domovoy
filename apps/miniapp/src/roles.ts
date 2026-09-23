import type { RoleView } from './views.js';

/** Роли словами смены: смена работает по-русски. */
export const ROLES: { value: RoleView; title: string }[] = [
  { value: 'resident', title: 'жилец' },
  { value: 'dispatcher', title: 'диспетчер' },
  { value: 'technician', title: 'мастер' },
  { value: 'manager', title: 'управляющий' },
  { value: 'contractor', title: 'подрядчик' },
];

export const roleTitle = (role: RoleView): string => ROLES.find((item) => item.value === role)?.title ?? role;
