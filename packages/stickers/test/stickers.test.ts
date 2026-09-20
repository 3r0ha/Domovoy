import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  DomainError,
  STICKER_STYLES,
  decodeTarget,
  planStickers,
  type StickerPlanOptions,
  type StickerStyleName,
} from '@domovoy/domain';

import { renderSheet, renderSticker, wrapText, writeStickers } from '../dist/index.js';

const APARTMENTS = [
  { id: 'apt-1', number: 1, entrance: 1, riser: 1, code: 'ACEFHK34' },
  { id: 'apt-2', number: 2, entrance: 1, riser: 2, code: 'LMNPRT47' },
  { id: 'apt-3', number: 3, entrance: 2, riser: 1, code: 'UVWXY349' },
  { id: 'apt-4', number: 4, entrance: 2, riser: 2, code: 'WXYWXY33' },
];

const options: StickerPlanOptions = {
  botName: 'uk_bot',
  buildingId: 'dom15',
  apartments: APARTMENTS,
  equipment: [{ code: 'lift-1', title: 'Лифт, подъезд 1' }],
};

describe('что и куда клеить', () => {
  it('покрывают подъезды, стояки и оборудование', () => {
    const plans = planStickers(options);

    assert.equal(plans.length, 2 * (1 + 2) + 1);
    assert.ok(plans.some((plan) => plan.caption === 'Подъезд 1, стояк 2'));
    assert.ok(plans.some((plan) => plan.caption === 'Лифт, подъезд 1'));
  });

  it('подъезды и стояки берутся из квартир дома, а не из круглого числа', () => {
    const plans = planStickers({
      ...options,
      apartments: [{ id: 'apt-9', number: 9, entrance: 3, riser: 7 }],
    });

    assert.deepEqual(
      plans.map((plan) => plan.caption),
      ['Подъезд 3', 'Подъезд 3, стояк 7', 'Лифт, подъезд 1'],
    );
  });

  it('коды квартир печатаются отдельно, для квитанций', () => {
    const plans = planStickers({ ...options, withApartments: true });
    const forFlat = plans.at(-1);

    assert.match(forFlat?.caption ?? '', /Квартира 4: код для квитанции/);
    assert.equal(plans.at(-4)?.payload, 'key_ACEFHK34', 'в коде лежит код из квитанции');
  });

  it('ведут на бота, а не на приложение', () => {
    const [first] = planStickers(options);

    assert.match(first?.link ?? '', /^https:\/\/max\.ru\/uk_bot\?start=/);
  });

  it('код на наклейке читается продуктом обратно', () => {
    for (const plan of planStickers({ ...options, withApartments: true })) {
      if (plan.target.kind === 'apartment') continue;

      assert.deepEqual(decodeTarget(plan.payload), plan.target, `не сошлось для «${plan.caption}»`);
    }
  });
});

describe('рисунок наклейки', () => {
  const [first] = planStickers(options);

  it('это картинка с кодом и подписью объекта', () => {
    const svg = renderSticker(first!);

    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<\/svg>$/);
    assert.match(svg, /Подъезд 1/);
  });

  it('своя надпись попадает в саму картинку', () => {
    const svg = renderSticker(first!, { note: 'Звонить в третью квартиру' });

    assert.match(svg, /Звонить в третью квартиру/);
  });

  it('длинную надпись обрезает, а не выносит за край', () => {
    assert.deepEqual(wrapText('Не работает кнопка вызова диспетчера', 12), ['Не работает', 'кнопка…']);
  });

  it('надпись длиннее предела не принимается', () => {
    assert.throws(
      () => renderSticker(first!, { note: 'слово '.repeat(40) }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'note_too_long');
        return true;
      },
    );
  });

  it('стиль меняет цвета и форму модулей', () => {
    const classic = renderSticker(first!, { style: 'classic' });
    const night = renderSticker(first!, { style: 'night' });

    assert.match(classic, /<rect[^>]*fill="#151515"/);
    assert.match(night, /<rect[^>]*fill="#12162a"/, 'модули у всех стилей квадратные');
    assert.equal(night.includes('<circle'), false);
    assert.match(night, /stop-color="#161a2b"/, 'фон карточки свой у каждого стиля');
    assert.match(night, /fill="#f4f6fb"/, 'подписи на тёмном фоне светлые');
  });

  it('код объекта на самой наклейке не печатается: он нужен листу, а не стене', () => {
    assert.equal(renderSticker(first!).includes(first!.payload), false);
  });

  it('в середине кода домик, а вокруг кода белое поле: код при этом читается', async () => {
    const jsQR = (await import('jsqr')).default;
    const { Resvg } = await import('@resvg/resvg-js');

    for (const style of Object.keys(STICKER_STYLES) as StickerStyleName[]) {
      const svg = renderSticker(first!, { style, note: 'Наведите камеру' });

      assert.match(svg, /<path[^>]*d="M12 3\.5/, 'домик в середине');

      for (const width of [720, 240]) {
        const image = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
        const read = jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height);

        assert.equal(read?.data, first!.link, `стиль «${style}» на ${width} px не читается`);
      }
    }
  });

  it('уголки-искатели рисуются целиком: по ним камера находит код', () => {
    const svg = renderSticker(first!, { style: 'night' });
    const finders = svg.match(/<g data-finder="1">(.*?)<\/g>/u)?.[1] ?? '';
    const frames = finders.match(/<rect[^>]*stroke=/g) ?? [];

    assert.equal(frames.length, 3);
  });

  it('подпись с разметкой остаётся текстом', () => {
    const svg = renderSticker({ ...first!, caption: '<script>alert(1)</script>' });

    assert.equal(svg.includes('<script>'), false);
    assert.match(svg, /&lt;script&gt;/);
  });

  it('на листе для печати под кодом стоит сам код', () => {
    const plans = planStickers({ ...options, withApartments: true });
    const sheet = renderSheet(
      'ул. Ленина, 15',
      plans.map((plan) => ({ ...plan, svg: '<svg/>' })),
    );

    assert.match(sheet, /key_ACEFHK34/);
    assert.match(sheet, /eqp_dom15_lift-1/);
  });

  it('лист для печати экранирует адрес и подписи', () => {
    const html = renderSheet('ул. "Ленина" & 15', [
      { ...planStickers(options)[0]!, svg: '<svg></svg>', payload: '<script>alert(1)</script>' },
    ]);

    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.match(html, /&quot;Ленина&quot; &amp; 15/);
  });
});

describe('запись наклеек на диск', () => {
  let directory: string;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'domovoy-stickers-'));
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('сохраняет коды и лист для печати', async () => {
    const plans = await writeStickers(directory, { ...options, buildingAddress: 'ул. Ленина, 15' });

    const files = await readdir(directory);

    assert.equal(files.includes('sheet.html'), true);
    for (const plan of plans) {
      assert.equal(files.includes(`${plan.payload}.svg`), true, `нет файла для «${plan.caption}»`);
    }

    const svg = await readFile(join(directory, `${plans[0]!.payload}.svg`), 'utf8');

    assert.match(svg, /^<svg/, 'сохранена картинка, а не описание');
  });
});
