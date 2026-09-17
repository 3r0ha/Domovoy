import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError, apartmentKeyOf, decodeTarget } from '@domovoy/domain';

import {
  InMemoryRepository,
  createCollectingNotifier,
  drawSticker,
  sendSticker,
  sendStickerSheet,
  stickerFor,
  stickerStyles,
  stickersFor,
  styleOf,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const OTHER_ID = 'b2';

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const stranger: Resident = {
  id: 'disp-2',
  maxUserId: 5006,
  displayName: 'Пётр',
  role: 'dispatcher',
  buildingId: OTHER_ID,
};

/** Рисование подменяется: прикладному слою важен не рисунок, а кому он достанется. */
const drawn: { caption: string; note?: string; style?: string }[] = [];

const setup = () => {
  const notifier = createCollectingNotifier();
  drawn.length = 0;

  const deps: AppDeps = {
    repository: new InMemoryRepository({
      buildings: [
        { id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', companyId: 'uk-1' },
        { id: OTHER_ID, code: 'Д1', address: 'ул. Мира, 1', companyId: 'uk-2' },
      ],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, code: 'ACEFHK34', number: 1, entrance: 1, riser: 1 },
        { id: 'apt-2', buildingId: BUILDING_ID, code: 'LMNPRT47', number: 2, entrance: 2, riser: 3 },
      ],
      residents: [maria, dispatcher, stranger],
      equipment: [{ buildingId: BUILDING_ID, code: 'lift-1', title: 'Лифт, подъезд 1' }],
    }),
    now: () => new Date('2026-09-07T10:00:00Z'),
    createId: () => 'id-1',
    defaultBuildingId: BUILDING_ID,
    botName: 'uk_bot',
    notifier,
    stickers: {
      svg(plan, look) {
        drawn.push({
          caption: plan.caption,
          ...(look?.note ? { note: look.note } : {}),
          ...(look?.style ? { style: look.style } : {}),
        });

        return `<svg data-code="${plan.payload}"></svg>`;
      },
    },
  };

  return { deps, notifier };
};

describe('наклейки с кодами объектов', () => {
  it('смена печатает весь дом: подъезды, стояки, оборудование и коды квартир', async () => {
    const { deps } = setup();

    const plans = await stickersFor(deps, dispatcher);

    assert.deepEqual(
      plans.map((plan) => plan.caption),
      [
        'Подъезд 1',
        'Подъезд 1, стояк 1',
        'Подъезд 2',
        'Подъезд 2, стояк 3',
        'Лифт, подъезд 1',
        'Квартира 1: код для квитанции',
        'Квартира 2: код для квитанции',
      ],
    );
  });

  it('жилец берёт свой подъезд, свой стояк и свою квартиру, а не соседский', async () => {
    const { deps } = setup();

    const plans = await stickersFor(deps, maria);

    assert.deepEqual(
      plans.map((plan) => plan.caption),
      ['Подъезд 1', 'Подъезд 1, стояк 1', 'Лифт, подъезд 1', 'Квартира 1: код для квитанции'],
    );
  });

  it('код наклейки читается продуктом обратно', async () => {
    const { deps } = setup();

    for (const plan of await stickersFor(deps, dispatcher)) {
      if (plan.target.kind === 'apartment') continue;

      assert.deepEqual(decodeTarget(plan.payload), plan.target, `не сошлось для «${plan.caption}»`);
    }
  });

  it('в наклейке квартиры лежит код из квитанции, а не её идентификатор', async () => {
    const { deps } = setup();
    const plans = await stickersFor(deps, dispatcher);
    const first = plans.find((plan) => plan.caption === 'Квартира 1: код для квитанции');

    assert.equal(apartmentKeyOf(first?.payload ?? ''), 'ACEFHK34');
    assert.equal(decodeTarget(first?.payload ?? ''), null, 'идентификатора квартиры в коде нет');
    assert.match(first?.link ?? '', /\?start=key_ACEFHK34$/);
  });

  it('наклейку чужого объекта не сделать', async () => {
    const { deps } = setup();
    const [foreign] = (await stickersFor(deps, dispatcher)).filter((plan) => plan.caption === 'Подъезд 2');

    await assert.rejects(stickerFor(deps, maria, foreign?.payload ?? ''), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, 'wrong_object');
      return true;
    });
  });

  it('дом чужой организации закрыт целиком', async () => {
    const { deps } = setup();

    await assert.rejects(stickersFor(deps, stranger, BUILDING_ID), /другая управляющая организация/);
  });

  it('наклейка уходит человеку файлом: оттуда её пересылают и сохраняют', async () => {
    const { deps, notifier } = setup();
    const [entrance] = await stickersFor(deps, maria);

    const sent = await sendSticker(deps, {
      resident: maria,
      payload: entrance?.payload ?? '',
      style: 'night',
      note: 'Звонить в первую квартиру',
    });

    const [file] = notifier.files;

    assert.equal(file?.maxUserId, maria.maxUserId);
    assert.equal(file?.as, 'document');
    assert.equal(file?.contentType, 'image/svg+xml');
    assert.equal(file?.name, `${entrance?.payload ?? ''}.svg`);
    assert.match(file?.text ?? '', /Звонить в первую квартиру/);
    assert.equal(sent.messageId, 'mid-file-1', 'по нему приложение перешлёт наклейку дальше');
    assert.deepEqual(drawn, [{ caption: 'Подъезд 1', note: 'Звонить в первую квартиру', style: 'night' }]);
  });

  it('где есть отрисовка в растр, наклейка уходит картинкой в ленту', async () => {
    const { deps, notifier } = setup();
    const [entrance] = await stickersFor(deps, maria);

    deps.stickers = { ...deps.stickers!, png: async () => Promise.resolve('UE5H') };

    const sent = await sendSticker(deps, { resident: maria, payload: entrance?.payload ?? '' });
    const [file] = notifier.files;

    assert.equal(sent.as, 'image');
    assert.equal(file?.as, 'image');
    assert.equal(file?.contentType, 'image/png');
    assert.equal(file?.encoding, 'base64');
    assert.equal(file?.name, `${entrance?.payload ?? ''}.png`);
  });

  it('файлом для печати наклейка уходит разметкой, даже когда растр есть', async () => {
    const { deps, notifier } = setup();
    const [entrance] = await stickersFor(deps, maria);

    deps.stickers = { ...deps.stickers!, png: async () => Promise.resolve('UE5H') };

    const sent = await sendSticker(deps, {
      resident: maria,
      payload: entrance?.payload ?? '',
      as: 'document',
    });

    assert.equal(sent.as, 'document');
    assert.equal(notifier.files[0]?.contentType, 'image/svg+xml');
  });

  it('лист для печати собирает весь дом и уходит файлом', async () => {
    const { deps, notifier } = setup();

    deps.stickers = {
      ...deps.stickers!,
      sheet: (address, plans) => `<html>${address}: ${plans.length}</html>`,
    };

    const sheet = await sendStickerSheet(deps, dispatcher);
    const [file] = notifier.files;

    assert.equal(sheet.count, 7, 'весь дом: подъезды, стояки, оборудование и коды квартир');
    assert.equal(file?.as, 'document');
    assert.match(file?.name ?? '', /^Наклейки, ул\. Ленина, 15\.html$/);
    assert.match(file?.content ?? '', /ул\. Ленина, 15: 7/);
  });

  it('лист для печати жильцу не собирают: клеить весь дом не ему', async () => {
    const { deps } = setup();

    deps.stickers = { ...deps.stickers!, sheet: () => '<html></html>' };

    await assert.rejects(sendStickerSheet(deps, maria), /управляющая компания/);
  });

  it('без настроенного рисования наклейка не делается, но и не ломает продукт', async () => {
    const { deps } = setup();
    const [entrance] = await stickersFor(deps, maria);

    delete deps.stickers;

    await assert.rejects(drawSticker(deps, maria, entrance?.payload ?? ''), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, 'stickers_unavailable');
      return true;
    });
  });

  it('неизвестный стиль это классика, а не отказ', () => {
    assert.equal(styleOf('морской'), 'classic');
    assert.equal(styleOf(undefined), 'classic');
    assert.equal(styleOf('night'), 'night');
    assert.ok(stickerStyles().some((style) => style.name === 'night' && style.title === 'Ночь'));
  });
});
