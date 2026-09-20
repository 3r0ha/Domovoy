import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Language } from '@domovoy/i18n';

import {
  InMemoryRepository,
  TRANSLATION_MISS_MS,
  textFingerprint,
  translateForReading,
  type AppDeps,
  type MachineTranslator,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-20T10:00:00Z');

const anvar: Resident = {
  id: 'res-anvar',
  maxUserId: 1001,
  displayName: 'Анвар',
  role: 'resident',
  buildingId: BUILDING_ID,
  language: 'uz',
};

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1002,
  displayName: 'Мария',
  role: 'resident',
  buildingId: BUILDING_ID,
  language: 'ru',
};

const olga: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
  // Язык в профиле смены ничего не меняет: очередь ведётся по-русски.
  language: 'uz',
};

interface Batch {
  texts: readonly string[];
  to: Language;
  from?: Language;
}

/** Служба перевода в проверках: запоминает пачки и отвечает подставным переводом. */
const fakeService = (
  answer: (text: string, to: Language) => string | undefined = (text, to) => `[${to}] ${text}`,
): { batches: Batch[]; machine: MachineTranslator } => {
  const batches: Batch[] = [];

  return {
    batches,
    machine: {
      async translate(texts, to, from) {
        batches.push({ texts: [...texts], to, ...(from ? { from } : {}) });

        return texts.map((text) => answer(text, to));
      },
    },
  };
};

const setup = (machine?: MachineTranslator, now: () => Date = () => NOW): AppDeps => ({
  repository: new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
    residents: [anvar, maria, olga],
  }),
  now,
  createId: () => 'id-1',
  defaultBuildingId: BUILDING_ID,
  ...(machine ? { machine } : {}),
});

describe('отпечаток текста', () => {
  it('один и тот же у одного текста и разный у разных', () => {
    assert.equal(textFingerprint('Отключение воды'), textFingerprint('Отключение воды'));
    assert.equal(textFingerprint(' Отключение воды '), textFingerprint('Отключение воды'));
    assert.notEqual(textFingerprint('Отключение воды'), textFingerprint('Отключение света'));
  });
});

describe('машинный перевод на чтении', () => {
  it('переводит текст один раз, а повторное чтение берёт его из хранилища', async () => {
    const { batches, machine } = fakeService();
    const deps = setup(machine);

    const first = await translateForReading(deps, anvar, ['Отключение воды', 'Отключение воды']);

    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0]?.texts, ['Отключение воды'], 'один текст, а не два одинаковых');
    assert.equal(batches[0]?.to, 'uz');
    assert.equal(batches[0]?.from, 'ru');
    assert.equal(first.of('Отключение воды'), '[uz] Отключение воды');
    assert.equal(first.machine('Отключение воды'), true);

    const second = await translateForReading(deps, anvar, ['Отключение воды']);

    assert.equal(batches.length, 1, 'службу второй раз не спрашивают');
    assert.equal(second.of('Отключение воды'), '[uz] Отключение воды');
    assert.equal(second.machine('Отключение воды'), true);
  });

  it('отказ службы оставляет исходный текст и не спрашивает её снова сразу', async () => {
    const { batches, machine } = fakeService(() => {
      throw new Error('служба недоступна');
    });

    const deps = setup(machine);
    const first = await translateForReading(deps, anvar, ['Отключение воды']);

    assert.equal(first.of('Отключение воды'), 'Отключение воды');
    assert.equal(first.machine('Отключение воды'), false);
    assert.equal(batches.length, 1);

    await translateForReading(deps, anvar, ['Отключение воды']);

    assert.equal(batches.length, 1, 'промах помнится, и службу не долбят');
  });

  it('через время промах забывается и службу спрашивают снова', async () => {
    let answers = 0;

    const machine: MachineTranslator = {
      async translate(texts) {
        answers += 1;

        return texts.map(() => (answers === 1 ? undefined : '[uz] Отключение воды'));
      },
    };

    let at = NOW;
    const deps = setup(machine, () => at);

    await translateForReading(deps, anvar, ['Отключение воды']);
    at = new Date(NOW.getTime() + TRANSLATION_MISS_MS + 1000);

    const later = await translateForReading(deps, anvar, ['Отключение воды']);

    assert.equal(answers, 2);
    assert.equal(later.of('Отключение воды'), '[uz] Отключение воды');
  });

  it('жильцу с русским языком службу не спрашивают', async () => {
    const { batches, machine } = fakeService();
    const deps = setup(machine);

    const said = await translateForReading(deps, maria, ['Отключение воды']);

    assert.equal(batches.length, 0);
    assert.equal(said.of('Отключение воды'), 'Отключение воды');
    assert.equal(said.machine('Отключение воды'), false);
  });

  it('смене перевод не подключается', async () => {
    const { batches, machine } = fakeService();
    const deps = setup(machine);

    const said = await translateForReading(deps, olga, ['Отключение воды']);

    assert.equal(batches.length, 0);
    assert.equal(said.of('Отключение воды'), 'Отключение воды');
  });

  it('без службы перевода тексты остаются такими, как написаны', async () => {
    const said = await translateForReading(setup(), anvar, ['Отключение воды']);

    assert.equal(said.of('Отключение воды'), 'Отключение воды');
    assert.equal(said.machine('Отключение воды'), false);
  });

  it('текст без букв в службу не уходит', async () => {
    const { batches, machine } = fakeService();

    await translateForReading(setup(machine), anvar, ['', '   ', '15', '№ 7']);

    assert.equal(batches.length, 0);
  });

  it('перевод, совпавший с исходным текстом, пометкой не отмечается', async () => {
    const { machine } = fakeService((text) => text);
    const said = await translateForReading(setup(machine), anvar, ['Лифт']);

    assert.equal(said.of('Лифт'), 'Лифт');
    assert.equal(said.machine('Лифт'), false);
  });

  it('молчание службы дольше срока не задерживает ответ', async () => {
    const machine: MachineTranslator = {
      translate: () => new Promise(() => undefined),
    };

    const said = await translateForReading(setup(machine), anvar, ['Отключение воды']);

    assert.equal(said.of('Отключение воды'), 'Отключение воды');
  });
});
