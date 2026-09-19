import { atBuilding, type MeterVisionDeps, type Resident, type Transcriber } from '@domovoy/app';
import { DomainError } from '@domovoy/domain';
import type { SessionAuth } from '@maxkit/server';

/** Что нужно маршрутам продукта: сценарии, часы и подключённые службы. */
export interface RoutesDeps extends MeterVisionDeps {
  /** Токен бота: им подписан телефон, полученный через `requestContact`. */
  botToken?: string;
  /** Расшифровка речи. Без неё голосовую ручку продукт не открывает. */
  transcriber?: Transcriber;
  /** Сессии: нужны там, где токен отзывается. */
  auth?: SessionAuth;
  /** Режим проверки: доступно переключение роли. */
  demo?: boolean;
}

/** Кто пришёл, и в каком доме он сейчас работает. @throws {DomainError} */
export const residentReader =
  (deps: RoutesDeps) =>
  async (maxUserId: number, buildingId?: string): Promise<Resident> => {
    const resident = await deps.repository.findResidentByMaxUserId(maxUserId);

    if (!resident) throw new DomainError('resident_not_found', 'Профиль не найден, перезапустите приложение');

    return atBuilding(deps, resident, buildingId);
  };
