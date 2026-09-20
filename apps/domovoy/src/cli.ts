import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { readFile, writeFile } from 'node:fs/promises';

import {
  APARTMENTS_TEMPLATE,
  DEFAULT_BOT_NAME,
  EQUIPMENT_TEMPLATE,
  InMemoryRepository,
  addBuilding,
  exportRequests,
  importApartments,
  importEquipment,
  lastMonth,
  makeManager,
  readingsCsv,
  updateBuilding,
  zoneOf,
  type AppDeps,
  type Resident,
} from '@domovoy/app';
import { isStickerStyle } from '@domovoy/domain';
import { writeStickers } from '@domovoy/stickers';
import { PostgresRepository, applyMigrations, clearData, fromPool } from '@domovoy/storage';
import pg from 'pg';

import { createApartmentCode } from './codes.js';
import { demoData, seedDemo } from './demo.js';
import { runWalkthrough } from './walkthrough.js';

/** Служебные команды: наполнить базу для показа и напечатать наклейки. */
const usage = `Команды:
  seed         очистить хранилище и наполнить демонстрационными данными
  stickers [--style <имя>]  наклейки с кодами объектов в каталог stickers/
  make-manager <maxUserId> [имя]  назначить первого управляющего
  add-building --code --address --company --owner --zone --manager  завести дом, в том числе другой организации
  building --code --address --company --zone --emergency --phone --email --hours --office --office-hours
                                             карточка дома
  import-equipment <файл.csv>  оборудование дома: код, название, вид
  import-apartments <файл.csv>  завести дом списком квартир с приборами
  export-readings  показания за прошлый месяц в CSV для ГИС ЖКХ
  export-requests  реестр заявок за прошлый месяц в CSV
  walkthrough  проиграть сценарий целиком: бот, сценарии и эмулятор платформы

Переменные окружения:
  DATABASE_URL   адрес Postgres; без него используется хранилище в памяти
  BOT_NAME       имя бота для ссылок на наклейках (по умолчанию uk_bot)
`;

/** Значения вида `--code Д15`. */
const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);

  return at > 0 ? process.argv[at + 1] : undefined;
};

const botName = process.env['BOT_NAME']?.trim() || DEFAULT_BOT_NAME;

const withRepository = async <T>(run: (deps: AppDeps) => Promise<T>, fresh = false): Promise<T> => {
  const url = process.env['DATABASE_URL'];

  if (!url) {
    console.warn('DATABASE_URL не задан, работаем с хранилищем в памяти, результат не сохранится');

    return run({
      repository: new InMemoryRepository(),
      now: () => new Date(),
      createId: randomUUID,
      createCode: createApartmentCode,
      defaultBuildingId: demoData().buildingId,
      botName,
    });
  }

  const pool = new pg.Pool({ connectionString: url });

  try {
    await applyMigrations(fromPool(pool));
    if (fresh) await clearData(pool);

    return await run({
      repository: new PostgresRepository(fromPool(pool)),
      now: () => new Date(),
      createId: randomUUID,
      createCode: createApartmentCode,
      defaultBuildingId: demoData().buildingId,
      botName,
    });
  } finally {
    await pool.end();
  }
};

const seed = async (): Promise<void> => {
  const data = await withRepository((deps) => seedDemo(deps, { withRequests: true }), true);

  console.log(`Дом: ${data.address} (${data.buildingCode})`);
  console.log('Второй дом: ул. Ленина, 17 (Д17), в нём квартира 4 у Марии: видно переключение квартир и домов.');
  console.log('Диспетчер Ольга работает в Д15, а живёт в Д17: у неё свои показания, квитанция и собрание.');
  console.log('Жильцы и сотрудники:');

  for (const resident of data.residents) {
    console.log(`  ${resident.displayName}: ${resident.role}, MAX id ${resident.maxUserId}`);
  }

  console.log(
    '\nЗаявки: в работе, новая аварийная, ожидающая ответа жильца, ждущая приёмки,\n' +
      'три закрытые по лифту и одна непринятая жильцом. Плюс история прошлого\n' +
      'месяца и работа, сданная с опозданием: на них видно сводку за период.',
  );

  console.log(
    '\nПо стояку 2 первого подъезда идут плановые работы: обращение оттуда\n' +
      'получит срок вместо номера заявки, а с первого стояка заведёт заявку.',
  );

  if (data.joinedRequestNumber) {
    console.log(
      `\nЗаявка ${data.joinedRequestNumber}: об одной проблеме сообщили ${data.reporters} жильца, ` +
        'обращение соседки присоединилось к ней, а не завело вторую.',
    );
  }

  console.log(
    '\nВ сводке по дому (/report у сотрудника) видно: склеенное обращение, лифт\n' +
      'с тремя поломками, работу, которую жилец не принял, и нарушенный норматив\n' +
      'по электрике, рядом с числами за прошлый период.',
  );

  console.log(
    '\nУ каждой квартиры три счётчика с историей показаний (/meters).\n' +
      'Идёт собрание собственников с недобранным кворумом (/vote): голос Ивана,\n' +
      '40 м² из 458, до кворума не хватает ещё 189 м².',
  );
};

const stickers = async (): Promise<void> => {
  const directory = join(process.cwd(), 'stickers');
  const name = flag('style');
  const style = name && isStickerStyle(name) ? name : undefined;

  const plans = await withRepository(async (deps) => {
    const buildingId = deps.defaultBuildingId;

    // Без базы наклейки печатаются по демонстрационному дому: иначе печатать нечего.
    if (!process.env['DATABASE_URL']) await seedDemo(deps);

    const building = await deps.repository.findBuilding(buildingId);

    return writeStickers(directory, {
      botName: deps.botName ?? DEFAULT_BOT_NAME,
      buildingId,
      buildingAddress: building?.address ?? '',
      apartments: await deps.repository.listApartments(buildingId),
      equipment: (await deps.repository.listEquipment(buildingId)).map((item) => ({
        code: item.code,
        title: item.title,
      })),
      withApartments: true,
      ...(style ? { look: { style } } : {}),
    });
  });

  console.log(`Готово ${plans.length} кодов в ${directory}`);
  console.log(`Лист для печати: ${join(directory, 'sheet.html')}`);

  for (const plan of plans) {
    console.log(`  ${plan.caption} → ${plan.link}`);
  }
};

/** Первый управляющий: с него начинается раздача ролей. */
const makeFirstManager = async (): Promise<void> => {
  const maxUserId = Number(process.argv[3]);

  if (!Number.isFinite(maxUserId)) {
    console.warn('Укажите идентификатор в MAX: make-manager <maxUserId> [имя]');
    process.exitCode = 1;
    return;
  }

  await withRepository(async (deps) => {
    const manager = await makeManager(deps, maxUserId, process.argv[4]);

    console.log(`${manager.displayName}: управляющий (${manager.id})`);
  });
};

/** Новый дом: так же подключается и вторая управляющая организация. */
const createBuilding = async (): Promise<void> => {
  const code = flag('code');

  if (!code) {
    console.warn('Укажите код дома: add-building --code Д15 --address "ул. Ленина, 15"');
    process.exitCode = 1;
    return;
  }

  await withRepository(async (deps) => {
    const building = await addBuilding(deps, {
      code,
      ...(flag('address') ? { address: flag('address') } : {}),
      ...(flag('company') ? { managementCompany: flag('company') } : {}),
      ...(flag('owner') ? { companyId: flag('owner') } : {}),
      ...(flag('zone') ? { timeZone: flag('zone') } : {}),
    });

    console.log(`${building.code}: ${building.address || 'адрес не задан'}, пояс ${building.timeZone}`);
    console.log(`Владелец: ${building.companyId ?? 'общий парк установки'}`);

    const maxUserId = Number(flag('manager'));

    if (!Number.isFinite(maxUserId)) {
      console.log('Управляющего дома назначьте флагом --manager <maxUserId>');
      return;
    }

    const manager = await makeManager(deps, maxUserId, flag('manager-name'), building.id);

    console.log(`${manager.displayName}: управляющий дома (${manager.id})`);
  });
};

/** Сведения об обслуживании из флагов: указанные меняются, остальные остаются. */
const serviceFlags = (): { service?: Record<string, string> } => {
  const service = {
    ...(flag('emergency') ? { emergencyPhone: flag('emergency') } : {}),
    ...(flag('phone') ? { phone: flag('phone') } : {}),
    ...(flag('email') ? { email: flag('email') } : {}),
    ...(flag('hours') ? { hours: flag('hours') } : {}),
    ...(flag('office') ? { office: flag('office') } : {}),
    ...(flag('office-hours') ? { officeHours: flag('office-hours') } : {}),
  };

  return Object.keys(service).length > 0 ? { service } : {};
};

/** Карточка дома: адрес, код для номеров заявок и часовой пояс. */
const setBuildingCard = async (): Promise<void> => {
  await withRepository(async (deps) => {
    const manager = await firstManager(deps);

    if (!manager) return;

    const building = await updateBuilding(deps, manager, {
      ...(flag('code') ? { code: flag('code') } : {}),
      ...(flag('address') ? { address: flag('address') } : {}),
      ...(flag('company') ? { managementCompany: flag('company') } : {}),
      ...(flag('zone') ? { timeZone: flag('zone') } : {}),
      ...serviceFlags(),
    });

    console.log(`${building.code}: ${building.address || 'адрес не задан'}, пояс ${building.timeZone}`);
  });
};

const firstManager = async (deps: AppDeps): Promise<Resident | undefined> => {
  const [building] = await deps.repository.listBuildings();

  if (!building) {
    console.warn('В хранилище нет ни одного дома');
    return undefined;
  }

  const manager = (await deps.repository.listStaff(building.id)).find((person) => person.role === 'manager');

  if (!manager) console.warn('В доме нет управляющего: сначала make-manager <maxUserId>');

  return manager;
};

/** Оборудование дома списком: от вида зависит регламент обслуживания. */
const importEquipmentFile = async (path: string | undefined): Promise<void> => {
  if (!path) {
    console.warn(`Укажите файл: import-equipment <файл.csv>\nПример содержимого:\n${EQUIPMENT_TEMPLATE}`);
    process.exitCode = 1;
    return;
  }

  const csv = await readFile(path, 'utf8');

  await withRepository(async (deps) => {
    const manager = await firstManager(deps);

    if (!manager) return;

    const result = await importEquipment(deps, manager, csv);

    console.log(`Заведено оборудования: ${result.added}`);

    for (const problem of result.problems) console.warn(`  строка ${problem.line}: ${problem.message}`);
  });
};

/** Заводит дом списком квартир из файла. */
const importApartmentsFile = async (path: string | undefined): Promise<void> => {
  if (!path) {
    console.warn('Укажите файл: import-apartments <файл.csv>');
    console.warn(`Пример содержимого:\n${APARTMENTS_TEMPLATE}`);
    process.exitCode = 1;
    return;
  }

  const csv = await readFile(path, 'utf8');

  await withRepository(async (deps) => {
    const [building] = await deps.repository.listBuildings();

    if (!building) {
      console.warn('В хранилище нет ни одного дома: заведите его до импорта квартир');
      return;
    }

    const manager = (await deps.repository.listStaff(building.id)).find((person) => person.role === 'manager');

    if (!manager) {
      console.warn('В доме нет управляющего: дом заводит он');
      return;
    }

    const result = await importApartments(deps, manager, csv);

    console.log(`Заведено ${result.added}, обновлено ${result.updated}, приборов ${result.meters}`);

    for (const problem of result.problems) console.warn(`  строка ${problem.line}: ${problem.message}`);
  });
};

const exportCsv = async (kind: 'readings' | 'requests'): Promise<void> => {
  await withRepository(async (deps) => {
    const [building] = await deps.repository.listBuildings();

    if (!building) {
      console.warn('В хранилище нет ни одного дома');
      return;
    }

    const period = lastMonth(deps.now(), await zoneOf(deps, building.id));
    const [staff] = (await deps.repository.listStaff(building.id)).filter((person) => person.role !== 'resident');

    if (kind === 'requests' && !staff) {
      console.warn('В доме нет сотрудников: реестр заявок выгружает управляющая компания');
      return;
    }

    const exported =
      kind === 'readings'
        ? await readingsCsv(deps, building.id, period)
        : await exportRequests(deps, staff!, period);

    const file = join(process.cwd(), exported.filename);

    await writeFile(file, exported.csv, 'utf8');
    console.log(`Готово: ${file}`);
  });
};

const main = async (): Promise<void> => {
  const command = process.argv[2];

  switch (command) {
    case 'seed':
      await seed();
      return;
    case 'stickers':
      await stickers();
      return;
    case 'make-manager':
      await makeFirstManager();
      return;
    case 'add-building':
      await createBuilding();
      return;
    case 'building':
      await setBuildingCard();
      return;
    case 'import-equipment':
      await importEquipmentFile(process.argv[3]);
      return;
    case 'import-apartments':
      await importApartmentsFile(process.argv[3]);
      return;
    case 'export-readings':
      await exportCsv('readings');
      return;
    case 'export-requests':
      await exportCsv('requests');
      return;
    case 'walkthrough':
      await runWalkthrough({
        log: (line) => console.log(line.who === '' ? `\n${line.text}` : `${line.who}: ${line.text}\n`),
      });
      return;
    default:
      console.log(usage);
      process.exitCode = command === undefined ? 0 : 1;
  }
};

main().catch((error: unknown) => {
  console.error('Команда не выполнена', error);
  process.exitCode = 1;
});
