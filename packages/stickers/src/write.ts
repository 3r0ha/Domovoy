import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  planStickers,
  stickerFileName,
  type StickerLook,
  type StickerPlan,
  type StickerPlanOptions,
} from '@domovoy/domain';

import { renderSheet, renderSticker } from './render.js';

export interface WriteStickersOptions extends StickerPlanOptions {
  buildingAddress: string;
  look?: StickerLook;
}

/** Сохраняет наклейки по отдельности и общий лист для печати. */
export const writeStickers = async (
  directory: string,
  options: WriteStickersOptions,
): Promise<StickerPlan[]> => {
  await mkdir(directory, { recursive: true });

  const plans = planStickers(options);
  const rendered: (StickerPlan & { svg: string })[] = [];

  for (const plan of plans) {
    const svg = renderSticker(plan, options.look);

    await writeFile(join(directory, stickerFileName(plan, 'svg')), svg, 'utf8');
    rendered.push({ ...plan, svg });
  }

  await writeFile(join(directory, 'sheet.html'), renderSheet(options.buildingAddress, rendered), 'utf8');

  return plans;
};
