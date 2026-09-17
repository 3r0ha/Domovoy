import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LEGAL_DOCUMENTS, LEGAL_VERSION, formatLegal, legalDocument } from '@domovoy/domain';

import { InMemoryRepository, acceptLegal, legalAccepted, type AppDeps, type Resident } from '../dist/index.js';

const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const setup = (): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
      residents: [maria],
    }),
    now: () => new Date('2026-09-22T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
  };
};

describe('документы продукта', () => {
  it('согласие даётся один раз и видно во всех интерфейсах', async () => {
    const deps = setup();

    assert.equal(legalAccepted(maria), false);

    // Согласие из переписки: бот и приложение читают одну и ту же запись человека.
    const saved = await acceptLegal(deps, maria);

    assert.equal(legalAccepted(saved), true);
    assert.equal(saved.legalVersion, LEGAL_VERSION);

    const fromStorage = await deps.repository.findResidentByMaxUserId(1001);

    assert.equal(legalAccepted(fromStorage!), true, 'приложение спросит согласие второй раз');

    const again = await acceptLegal(deps, fromStorage!);

    assert.equal(again.legalAt?.getTime(), saved.legalAt?.getTime(), 'повторное согласие переписало отметку');
  });

  it('новая редакция документов спрашивается заново', async () => {
    const stale: Resident = { ...maria, legalVersion: '2020-01-01', legalAt: new Date('2020-01-01') };

    assert.equal(legalAccepted(stale), false);
  });

  it('документы одинаковы всюду: один текст с указанием редакции', () => {
    const privacy = legalDocument('privacy');

    assert.equal(LEGAL_DOCUMENTS.length, 2);
    assert.ok(privacy, 'политики обработки данных нет');
    assert.match(formatLegal(privacy), /Политика обработки персональных данных/);
    assert.match(formatLegal(privacy), /152-ФЗ/, 'основание обработки не названо');
    assert.equal(legalDocument('nothing'), undefined);
  });
});
