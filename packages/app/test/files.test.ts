import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  MAX_FILE_BYTES,
  createCollectingNotifier,
  createServiceRequest,
  fileIdFromToken,
  isOwnFile,
  readFile,
  transitionRequest,
  uploadFile,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const neighbour: Resident = {
  id: 'res-pyotr',
  maxUserId: 1002,
  displayName: 'Пётр',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const alienDispatcher: Resident = {
  id: 'disp-2',
  maxUserId: 5006,
  displayName: 'Диспетчер соседнего дома',
  role: 'dispatcher',
  buildingId: 'b2',
};

const setup = (): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [
        { id: BUILDING_ID, code: 'Д15' },
        { id: 'b2', code: 'Д17' },
      ],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 1 },
      ],
      residents: [maria, neighbour, dispatcher, alienDispatcher],
    }),
    now: () => new Date('2026-09-03T10:00:00Z'),
    createId: () => `file-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
  };
};

/** Ровно то, что присылает браузер: содержимое снимка строкой base64. */
const photo = (bytes = 32): string => Buffer.alloc(bytes, 7).toString('base64');

describe('снимки к заявке', () => {
  it('снимок сохраняется и возвращается вложением', async () => {
    const deps = setup();

    const attachment = await uploadFile(deps, maria, { contentType: 'image/jpeg', base64: photo() });

    assert.equal(attachment.kind, 'photo');
    assert.ok(isOwnFile(attachment.token));

    const stored = await deps.repository.findFile(fileIdFromToken(attachment.token));

    assert.equal(stored?.contentType, 'image/jpeg');
    assert.equal(stored?.bytes.length, 32);
    assert.equal(stored?.uploadedBy, maria.id);
    assert.equal(stored?.buildingId, BUILDING_ID);
  });

  it('префикс data: отрезается сам', async () => {
    const deps = setup();

    const attachment = await uploadFile(deps, maria, {
      contentType: 'image/png',
      base64: `data:image/png;base64,${photo(16)}`,
    });

    assert.equal((await deps.repository.findFile(fileIdFromToken(attachment.token)))?.bytes.length, 16);
  });

  it('не изображение не берут', async () => {
    const deps = setup();

    await assert.rejects(
      uploadFile(deps, maria, { contentType: 'application/pdf', base64: photo() }),
      /фотографию, а не файл/,
    );
  });

  it('пустой файл не берут', async () => {
    const deps = setup();

    await assert.rejects(uploadFile(deps, maria, { contentType: 'image/jpeg', base64: '' }), /Файл пустой/);
  });

  it('слишком большой снимок отклоняют понятными словами', async () => {
    const deps = setup();

    await assert.rejects(
      uploadFile(deps, maria, { contentType: 'image/jpeg', base64: photo(MAX_FILE_BYTES + 1) }),
      /слишком большой/,
    );
  });

  it('автор смотрит свой снимок', async () => {
    const deps = setup();

    const attachment = await uploadFile(deps, maria, { contentType: 'image/jpeg', base64: photo() });
    const file = await readFile(deps, maria, fileIdFromToken(attachment.token));

    assert.equal(file.bytes.length, 32);
  });

  it('диспетчер дома смотрит снимок жильца', async () => {
    const deps = setup();

    const attachment = await uploadFile(deps, maria, { contentType: 'image/jpeg', base64: photo() });

    assert.equal((await readFile(deps, dispatcher, fileIdFromToken(attachment.token))).uploadedBy, maria.id);
  });

  it('соседу чужой снимок не показывают', async () => {
    const deps = setup();

    const attachment = await uploadFile(deps, maria, { contentType: 'image/jpeg', base64: photo() });

    await assert.rejects(
      readFile(deps, neighbour, fileIdFromToken(attachment.token)),
      /вам не принадлежит/,
    );
  });

  it('сотруднику другого дома снимок не показывают', async () => {
    const deps = setup();

    const attachment = await uploadFile(deps, maria, { contentType: 'image/jpeg', base64: photo() });

    await assert.rejects(
      readFile(deps, alienDispatcher, fileIdFromToken(attachment.token)),
      /вам не принадлежит/,
    );
  });

  it('несуществующий файл, не «доступ запрещён», а «не найден»', async () => {
    const deps = setup();

    await assert.rejects(readFile(deps, dispatcher, 'file-нет'), /Файл не найден/);
  });

  it('справку, приложенную сотрудником, жилец открывает', async () => {
    const deps = setup();

    const request = await createServiceRequest(deps, {
      resident: maria,
      description: 'Нужна справка о составе семьи',
    });

    assert.equal(request.category, 'document');

    const paper = await uploadFile(deps, dispatcher, { contentType: 'image/jpeg', base64: photo() });

    for (const to of ['accepted', 'in_progress'] as const) {
      await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to });
    }

    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'done',
      attachments: [paper],
    });

    const file = await readFile(deps, maria, fileIdFromToken(paper.token));

    assert.equal(file.uploadedBy, dispatcher.id);
    await assert.rejects(readFile(deps, neighbour, fileIdFromToken(paper.token)), /вам не принадлежит/);
  });
});
