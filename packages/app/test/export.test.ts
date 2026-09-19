import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BOM,
  InMemoryRepository,
  createCollectingNotifier,
  createServiceRequest,
  exportRequests,
  lastMonth,
  readingsCsv,
  sendReadingsExport,
  sendRequestsExport,
  submitReading,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-10T10:00:00Z');
const AUGUST = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { setNow: (at: Date) => void };

const setup = async (): Promise<Deps> => {
  let counter = 0;
  let now = NOW;

  const deps: Deps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 7, entrance: 1, riser: 1 }],
      residents: [maria, dispatcher],
    }),
    now: () => now,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    setNow: (at) => {
      now = at;
    },
  };

  await deps.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

  return deps;
};

describe('выгрузка показаний', () => {
  it('собирает файл по дому за период', async () => {
    const deps = await setup();

    deps.setNow(new Date('2026-08-22T10:00:00Z'));
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 120.5 });

    // Сентябрьское показание идёт в своё окно: подача 5 сентября относилась бы
    // ещё к августовскому расчётному периоду.
    deps.setNow(new Date('2026-09-22T10:00:00Z'));
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 124 });

    const { csv, filename } = await readingsCsv(deps, BUILDING_ID, AUGUST);
    const [head, ...rows] = csv.replace(BOM, '').trimEnd().split('\r\n');

    assert.equal(head, 'Адрес;Помещение;Прибор учёта;Вид ресурса;Дата;Показание;Единица');
    assert.deepEqual(rows, ['ул. Ленина, 15;7;ХВС-1;Холодная вода;22.08.2026;120,5;м³']);
    assert.equal(filename, 'показания-Д15-2026-08-01_2026-08-31.csv');
    assert.equal(csv.startsWith(BOM), true);
  });

  it('точку с запятой в адресе не ломает строку', async () => {
    const deps = await setup();

    await deps.repository.saveBuilding({
      id: BUILDING_ID,
      code: 'Д15',
      address: 'ул. Ленина, 15; корпус 2',
      managementCompany: 'УК',
    });

    deps.setNow(new Date('2026-08-22T10:00:00Z'));
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 120 });

    const { csv } = await readingsCsv(deps, BUILDING_ID, AUGUST);

    assert.match(csv, /"ул\. Ленина, 15; корпус 2";7;/);
  });
});

describe('реестр заявок за календарный месяц', () => {
  it('берёт месяц, а не последние тридцать дней', async () => {
    const deps = await setup();

    deps.setNow(new Date('2026-08-10T10:00:00Z'));
    await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    deps.setNow(new Date('2026-09-05T10:00:00Z'));
    await createServiceRequest(deps, { resident: maria, description: 'Не горит лампа в подъезде' });

    const { csv, filename } = await exportRequests(deps, dispatcher, AUGUST);

    assert.match(csv, /Течёт кран на кухне/);
    assert.doesNotMatch(csv, /Не горит лампа/, 'сентябрьская заявка в августовский файл не идёт');
    assert.match(filename, /2026-08-01_2026-08-31/);
  });
});

describe('период и имя файла', () => {
  it('по умолчанию берётся прошлый месяц', () => {
    const period = lastMonth(new Date('2026-09-10T10:00:00Z'), 'Europe/Moscow');

    assert.equal(period.from.toISOString().slice(0, 10), '2026-08-01');
    assert.equal(period.to.toISOString().slice(0, 10), '2026-08-31');
  });

  it('январская выгрузка берёт декабрь прошлого года', () => {
    const period = lastMonth(new Date('2026-01-10T10:00:00Z'), 'Europe/Moscow');

    assert.equal(period.from.toISOString().slice(0, 10), '2025-12-01');
    assert.equal(period.to.toISOString().slice(0, 10), '2025-12-31');
  });

});

describe('выгрузка файлом в переписку', () => {
  it('реестр заявок уходит смене файлом', async () => {
    const deps = await setup();
    const notifier = createCollectingNotifier();

    await createServiceRequest({ ...deps, notifier }, { resident: maria, description: 'Течёт кран на кухне' });

    const sent = await sendRequestsExport({ ...deps, notifier }, dispatcher, 30);

    assert.match(sent.filename, /\.csv$/);
    assert.equal(notifier.files.length, 1);
    assert.equal(notifier.files[0]?.as, 'document');
    assert.equal(notifier.files[0]?.maxUserId, dispatcher.maxUserId);
    assert.match(notifier.files[0]?.content ?? '', /Течёт кран на кухне/);
  });

  it('показания дома уходят смене файлом', async () => {
    const deps = await setup();
    const notifier = createCollectingNotifier();

    deps.setNow(new Date('2026-08-21T10:00:00Z'));
    await submitReading({ ...deps, notifier }, { resident: maria, meterId: 'cold-1', value: 140.2 });
    deps.setNow(NOW);

    const sent = await sendReadingsExport({ ...deps, notifier }, dispatcher);

    assert.match(sent.filename, /\.csv$/);
    assert.equal(notifier.files.length, 1);
    assert.match(notifier.files[0]?.content ?? '', /140,2|140.2/);
  });

  it('жильцу выгрузки не отдают', async () => {
    const deps = await setup();
    const notifier = createCollectingNotifier();

    await assert.rejects(sendRequestsExport({ ...deps, notifier }, maria), /доступен смене/);
    await assert.rejects(sendReadingsExport({ ...deps, notifier }, maria), /доступны смене/);
    assert.equal(notifier.files.length, 0);
  });

  it('без канала доставки отказ понятен', async () => {
    const deps = await setup();

    await assert.rejects(sendRequestsExport(deps, dispatcher), /Отправка файлов не настроена/);
  });
});
