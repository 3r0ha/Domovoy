import { DomainError } from '@domovoy/domain';

import { recordAction } from './audit.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/**
 * Как человека зовут. Имя приходит из профиля MAX и обновляется при каждом
 * входе: человек мог его сменить, и смена должна видеть новое. Но в профиле
 * платформы у людей стоят никнеймы, а мастеру идти к «xXx_kotik_xXx» некуда,
 * поэтому имя можно задать своё. Заданное вручную платформой не перебивается.
 */

/** Сколько знаков помещается в имя. */
export const NAME_MAX_LENGTH = 60;

/** Наименьшее имя, которое ещё имя, а не опечатка. */
export const NAME_MIN_LENGTH = 2;

/** Имя без разметки и лишних пробелов. @throws {DomainError} */
export const checkName = (name: string): string => {
  const said = name.replace(/\s+/gu, ' ').trim().slice(0, NAME_MAX_LENGTH);

  if (said.length < NAME_MIN_LENGTH) {
    throw new DomainError('name_invalid', `Имя это хотя бы ${NAME_MIN_LENGTH} знака`);
  }

  // Имя видят соседи в заявках и смена в очереди: ссылке и разметке там не место.
  if (/https?:\/\/|[<>{}]/u.test(said)) {
    throw new DomainError('name_invalid', 'В имени не бывает ссылок и разметки');
  }

  return said;
};

/** Человек называет себя сам. Дальше имя из платформы его не меняет. @throws {DomainError} */
export const renameSelf = async (deps: AppDeps, resident: Resident, name: string): Promise<Resident> => {
  const said = checkName(name);

  if (said === resident.displayName && resident.nameByUser) return resident;

  const saved = await deps.repository.saveResident({ ...resident, displayName: said, nameByUser: true });

  // Имя сотрудника видят жильцы в заявках: смена имени остаётся в журнале дома.
  if (resident.role !== 'resident' && resident.buildingId) {
    await recordAction(deps, {
      actor: saved,
      action: 'role_assigned',
      subject: saved.displayName,
      buildingId: resident.buildingId,
      details: `сменил имя с «${resident.displayName}»`,
    });
  }

  return saved;
};

/**
 * Вернуть имя из профиля MAX: человек передумал называть себя сам. Имя
 * подставит ближайший вход, здесь снимается только запрет его обновлять.
 */
export const resetName = async (deps: AppDeps, resident: Resident): Promise<Resident> =>
  resident.nameByUser ? deps.repository.saveResident({ ...resident, nameByUser: undefined }) : resident;
