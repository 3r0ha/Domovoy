import { DomainError } from '@domovoy/domain';

import { fileIdFromToken, isOwnFile, readFile } from './files.js';
import { ownMeter } from './meters.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Порт распознавания показаний с фотографии табло. */
export interface MeterVision {
  /** Показание с фотографии. `undefined` означает, что показание не разобрали. */
  read(image: Blob): Promise<number | undefined>;
  /** То же по ссылке: в чате фотография остаётся у платформы. */
  readUrl?(url: string): Promise<number | undefined>;
}

export interface MeterVisionDeps extends AppDeps {
  vision?: MeterVision;
}

export interface ReadMeterPhotoCommand {
  resident: Resident;
  meterId: string;
  /** Снимок табло: тот же токен, что у фото к заявке. */
  token: string;
}

/** Показание с фотографии табло. @throws {DomainError} */
export const readMeterPhoto = async (
  deps: MeterVisionDeps,
  command: ReadMeterPhotoCommand,
): Promise<number | undefined> => {
  if (!deps.vision) throw new DomainError('vision_unavailable', 'Распознавание показаний не подключено');

  const meter = await deps.repository.findMeter(command.meterId);

  if (!meter) throw new DomainError('meter_not_found', 'Счётчик не найден');

  if (!(await ownMeter(deps, command.resident, meter))) {
    throw new DomainError('forbidden', 'Это счётчик другой квартиры');
  }

  if (!isOwnFile(command.token)) {
    throw new DomainError('file_not_found', 'Снимок должен быть загружен в продукт');
  }

  const file = await readFile(deps, command.resident, fileIdFromToken(command.token));

  return deps.vision.read(new Blob([new Uint8Array(file.bytes)], { type: file.contentType }));
};
