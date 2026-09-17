import { createRequire } from 'node:module';

import type { StickerLook, StickerPlan } from '@domovoy/domain';

import { renderSticker } from './render.js';

const require = createRequire(import.meta.url);

/**
 * Шрифт наклейки лежит рядом, а не в системе: в контейнере шрифтов обычно нет,
 * и надпись вышла бы пустыми квадратами.
 */
const FONT_FILES = [
  '@expo-google-fonts/roboto/400Regular/Roboto_400Regular.ttf',
  '@expo-google-fonts/roboto/500Medium/Roboto_500Medium.ttf',
];

/** Ширина картинки в точках: с такой наклейку печатают и читают с экрана. */
export const STICKER_PNG_WIDTH = 720;

type Rasterizer = (svg: string, width: number) => Buffer;

let loading: Promise<Rasterizer | undefined> | undefined;

const load = async (): Promise<Rasterizer | undefined> => {
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const fontFiles = FONT_FILES.map((file) => require.resolve(file));

    return (svg, width) =>
      Buffer.from(
        new Resvg(svg, {
          font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Roboto' },
          fitTo: { mode: 'width', value: width },
        })
          .render()
          .asPng(),
      );
  } catch {
    return undefined;
  }
};

/** Готова ли отрисовка в растр: без неё наклейка остаётся разметкой. */
export const canRasterize = async (): Promise<boolean> => (await rasterizer()) !== undefined;

const rasterizer = (): Promise<Rasterizer | undefined> => {
  loading ??= load();

  return loading;
};

/** Наклейка картинкой PNG: её показывают в ленте чата прямо с надписью. */
export const renderStickerPng = async (
  plan: StickerPlan,
  look: StickerLook = {},
  width = STICKER_PNG_WIDTH,
): Promise<Buffer> => {
  const draw = await rasterizer();

  if (!draw) throw new Error('Отрисовка наклейки в PNG недоступна');

  return draw(renderSticker(plan, look), width);
};
