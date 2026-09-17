import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { InMemoryRepository } from '@domovoy/app';

import { demoData, seedDemo } from '../apps/domovoy/dist/demo.js';

/**
 * Тестовые данные файлами: тот же набор, который заводит `seed`, выгруженный
 * в JSON и в CSV импорта. Нужен для воспроизводимой проверки без запуска
 * продукта. Момент времени задан, поэтому файл не меняется от запуска к запуску.
 */
const NOW = new Date('2026-09-22T10:00:00Z');
const OUT = fileURLToPath(new URL('../testdata/', import.meta.url));

let counter = 0;
const repository = new InMemoryRepository();
const deps = {
  repository,
  now: () => NOW,
  createId: () => `id-${++counter}`,
  defaultBuildingId: demoData().buildingId,
  botName: 'uk_bot',
};

const data = await seedDemo(deps, { withRequests: true });

const day = (at) => (at instanceof Date ? at.toISOString() : at);

const buildings = await repository.listBuildings();
const houses = [];

for (const building of buildings) {
  const apartments = await repository.listApartments(building.id);
  const meters = await repository.listMetersByApartments(apartments.map((apartment) => apartment.id));
  const readings = await repository.listReadingsFor(meters.map((meter) => meter.id));
  const requests = await repository.listRequests({ buildingId: building.id });
  const polls = await repository.listPolls(building.id);
  const tickets = await repository.listSupportTickets({ buildingId: building.id });

  houses.push({
    id: building.id,
    code: building.code,
    address: building.address,
    managementCompany: building.managementCompany ?? null,
    timeZone: building.timeZone ?? null,
    contact: building.contact ?? null,
    service: building.service ?? null,
    partners: building.partners ?? null,
    equipment: await repository.listEquipment(building.id),
    tariffs: (await repository.listTariffs(building.id)).map((record) => ({
      kind: record.kind,
      value: record.value,
      since: day(record.since),
    })),
    apartments: apartments.map((apartment) => ({
      id: apartment.id,
      code: apartment.code ?? null,
      number: apartment.number,
      entrance: apartment.entrance,
      riser: apartment.riser,
      area: apartment.area ?? null,
      residents: apartment.residents ?? null,
    })),
    meters: meters.map((meter) => ({
      id: meter.id,
      apartmentId: meter.apartmentId,
      kind: meter.kind,
      serial: meter.serial,
      verifiedUntil: meter.verifiedUntil ? day(meter.verifiedUntil) : null,
      readings: readings
        .filter((reading) => reading.meterId === meter.id)
        .map((reading) => ({ value: reading.value, at: day(reading.at) })),
    })),
    requests: requests.map((request) => ({
      number: request.number,
      category: request.category,
      priority: request.priority,
      status: request.status,
      title: request.title,
      description: request.description,
      target: request.target,
      createdAt: day(request.createdAt),
      reactionDueAt: day(request.reactionDueAt),
      resolutionDueAt: day(request.resolutionDueAt),
      reporters: request.reporterIds?.length ?? 1,
      history: request.history.map((event) => ({
        at: day(event.at),
        status: event.status,
        role: event.role,
        comment: event.comment ?? null,
      })),
    })),
    announcements: (await repository.listAnnouncements(building.id)).map((item) => ({
      title: item.title,
      body: item.body,
      createdAt: day(item.createdAt),
      kind: item.kind ?? null,
      until: item.until ? day(item.until) : null,
    })),
    polls: polls.map((poll) => ({
      id: poll.id,
      kind: poll.kind,
      title: poll.title,
      question: poll.question,
      opensAt: day(poll.opensAt),
      closesAt: day(poll.closesAt),
    })),
    support: tickets.map((ticket) => ({
      subject: ticket.subject,
      status: ticket.status,
      createdAt: day(ticket.createdAt),
      messages: ticket.messages.map((message) => ({ from: message.from, text: message.text, at: day(message.at) })),
    })),
  });
}

const people = [];

for (const building of buildings) {
  for (const person of await repository.listResidents(building.id)) {
    if (people.some((known) => known.id === person.id)) continue;

    people.push({
      id: person.id,
      maxUserId: person.maxUserId ?? null,
      displayName: person.displayName,
      role: person.role,
      buildingId: person.buildingId ?? null,
      apartmentId: person.apartmentId ?? null,
      phone: person.phone ?? null,
    });
  }
}

const dump = {
  about: [
    'Тестовые данные решения «Домовой» для трека «Умный город».',
    'Данные вымышленные: адресов, людей и лицевых счетов из реальной жизни в наборе нет.',
    'Тот же набор заводит команда `npm run seed --workspace @domovoy/server`.',
  ],
  generatedFor: NOW.toISOString(),
  people,
  houses,
};

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}demo.json`, `${JSON.stringify(dump, null, 2)}\n`);

/** Квартиры дома в том же виде, в каком их принимает импорт. */
const apartmentsCsv = (house) =>
  [
    'Помещение;Подъезд;Стояк;Площадь;Жильцов;Холодная вода;Горячая вода;Электричество',
    ...house.apartments.map((apartment) => {
      const serial = (kind) =>
        house.meters.find((meter) => meter.apartmentId === apartment.id && meter.kind === kind)?.serial ?? '';

      return [
        apartment.number,
        apartment.entrance,
        apartment.riser,
        String(apartment.area ?? '').replace('.', ','),
        apartment.residents ?? '',
        serial('cold_water'),
        serial('hot_water'),
        serial('electricity'),
      ].join(';');
    }),
  ].join('\n');

/** Вид оборудования импорт принимает словом, а не внутренним кодом. */
const KIND_WORDS = { lift: 'лифт', intercom: 'домофон', barrier: 'шлагбаум', meter_unit: 'узел учёта' };

const equipmentCsv = (house) =>
  [
    'Код;Название;Вид',
    ...house.equipment.map((item) => [item.code, item.title, KIND_WORDS[item.kind] ?? ''].join(';')),
  ].join('\n');

const main = houses.find((house) => house.id === data.buildingId) ?? houses[0];

await writeFile(`${OUT}apartments.csv`, `${apartmentsCsv(main)}\n`);
await writeFile(`${OUT}equipment.csv`, `${equipmentCsv(main)}\n`);

console.log(
  `testdata/: ${people.length} человек, ${houses.length} дома, ${main.apartments.length} помещений, ${main.requests.length} заявок`,
);
