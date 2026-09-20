import {
  answerAlert,
  answerSupport,
  askSupport,
  checkInspectionItem,
  closePoll,
  createServiceRequest,
  periodOf,
  planInspections,
  publishAnnouncement,
  setDuty,
  startPoll,
  submitProblem,
  vote,
  transitionRequest,
  type AppDeps,
  type Resident,
} from '@domovoy/app';
import type { Device, DeviceEvent, Equipment, HouseContact, HousePartner, HouseService } from '@domovoy/app';
import {
  LEGAL_VERSION,
  READING_WINDOW,
  type Apartment,
  type ReceptionWindow,
  type RequestCategory,
} from '@domovoy/domain';

export interface DemoData {
  buildingId: string;
  buildingCode: string;
  address: string;
  managementCompany: string;
  /** Ответственный по дому: его показывает поддержка и команда /contacts. */
  contact: HouseContact;
  /** Аварийная служба, телефоны организации и приём. */
  service: HouseService;
  /** Приёмные окна: по ним жилец записывается на приём. */
  reception: ReceptionWindow[];
  /** Смежные организации: им передаются обращения не из зоны управляющей. */
  partners: HousePartner[];
  apartments: Apartment[];
  /** Общее оборудование с наклейками: лифты и домофон. */
  equipment: Equipment[];
  residents: Resident[];
  /** Номер заявки, к которой присоединился сосед. */
  joinedRequestNumber?: string;
  /** Сколько жильцов сообщили об этой проблеме. */
  reporters?: number;
}

const BUILDING_ID = 'dom15';

/** Обычный набор дома: за портом заглушка, поэтому список задан здесь. */
export const demoDevices = (buildingId: string = BUILDING_ID): Device[] =>
  buildingId !== BUILDING_ID
    ? []
    : [
        { id: 'intercom-1', buildingId, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 },
        { id: 'camera-1', buildingId, kind: 'camera', title: 'Камера у подъезда 1', entrance: 1 },
        { id: 'intercom-2', buildingId, kind: 'intercom', title: 'Домофон, подъезд 2', entrance: 2 },
        { id: 'camera-2', buildingId, kind: 'camera', title: 'Камера у подъезда 2', entrance: 2 },
        { id: 'barrier-1', buildingId, kind: 'barrier', title: 'Шлагбаум во двор' },
        { id: 'leak-1-2', buildingId, kind: 'leak', title: 'Датчик протечки, стояк 2', entrance: 1, riser: 2 },
        { id: 'smoke-1', buildingId, kind: 'smoke', title: 'Датчик дыма, подъезд 1', entrance: 1 },
      ];

/** Связь датчиков: один выходил на связь недавно, второй двое суток назад. */
export const demoSensorContact = (now: Date): Record<string, Date> => ({
  'leak-1-2': new Date(now.getTime() - 40 * 60_000),
  'smoke-1': new Date(now.getTime() - 50 * 60 * 60_000),
});

/** Записи журнала открытий за прошедшие сутки. */
export const demoDoorHistory = (now: Date): DeviceEvent[] => {
  const ago = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);

  return [
    { deviceId: 'intercom-1', at: ago(320), action: 'opened', by: 'resident', residentId: 'res-maria' },
    { deviceId: 'barrier-1', at: ago(295), action: 'opened', by: 'resident', residentId: 'res-ivan' },
    { deviceId: 'intercom-2', at: ago(180), action: 'opened', by: 'resident', residentId: 'res-anna' },
    { deviceId: 'intercom-1', at: ago(95), action: 'guest-code', by: 'resident', residentId: 'res-maria' },
    { deviceId: 'intercom-1', at: ago(88), action: 'opened', by: 'guest', residentId: 'res-maria' },
    { deviceId: 'camera-1', at: ago(40), action: 'snapshot', by: 'resident', residentId: 'staff-dispatcher' },
  ];
};

/** Данные для показа. */
export const demoData = (): DemoData => ({
  buildingId: BUILDING_ID,
  buildingCode: 'Д15',
  address: 'ул. Ленина, 15',
  managementCompany: 'ООО «УК Ленинская»',
  contact: {
    name: 'Гордеева Нина Павловна',
    role: 'управляющая домом',
    phone: '+7 900 120-45-15',
    email: 'nina@uk-leninskaya.ru',
  },
  reception: [
    { weekday: 2, from: '15:00', to: '19:00' },
    { weekday: 4, from: '15:00', to: '19:00' },
  ],
  // Организации дома вымышленные, как и весь набор для показа.
  partners: [
    {
      kind: 'resource',
      title: 'МУП «Водоканал»',
      categories: ['plumbing'],
      phone: '+7 900 130-10-10',
      channel: 'email',
    },
    {
      kind: 'resource',
      title: 'АО «Теплосеть»',
      categories: ['heating'],
      phone: '+7 900 130-20-20',
      channel: 'email',
    },
    {
      kind: 'contractor',
      title: 'ООО «Лифтсервис»',
      categories: ['elevator'],
      phone: '+7 900 130-30-30',
      channel: 'phone',
    },
    {
      kind: 'municipal',
      title: 'Администрация Ленинского района',
      categories: ['yard'],
      phone: '+7 900 130-40-40',
      channel: 'pos',
    },
    {
      kind: 'inspection',
      title: 'Государственная жилищная инспекция области',
      phone: '+7 900 130-50-50',
      channel: 'gis_zhkh',
    },
  ],
  service: {
    emergencyPhone: '+7 900 120-00-15',
    phone: '+7 900 120-45-00',
    email: 'uk@uk-leninskaya.ru',
    hours: 'пн-пт 9:00-18:00',
    office: 'ул. Ленина, 15, офис 1',
    officeHours: 'вт и чт 15:00-19:00',
  },
  // Коды квартир для показа заданы, чтобы набор данных не менялся от запуска
  // к запуску. В работе их выдаёт продукт случайно.
  apartments: [
    { id: 'apt-1', buildingId: BUILDING_ID, code: 'KVMR4783', number: 1, entrance: 1, riser: 1, area: 55, residents: 3 },
    { id: 'apt-2', buildingId: BUILDING_ID, code: 'HTPN9434', number: 2, entrance: 1, riser: 2, area: 40, residents: 2 },
    { id: 'apt-3', buildingId: BUILDING_ID, code: 'LWEC7439', number: 3, entrance: 1, riser: 2, area: 35, residents: 2 },
    { id: 'apt-6', buildingId: BUILDING_ID, code: 'NRUA8374', number: 6, entrance: 1, riser: 2, area: 25, residents: 1 },
    { id: 'apt-10', buildingId: BUILDING_ID, code: 'YMCF4798', number: 10, entrance: 1, riser: 2, area: 20, residents: 1 },
    { id: 'apt-20', buildingId: BUILDING_ID, code: 'XPTK3947', number: 20, entrance: 2, riser: 1, area: 25, residents: 1 },
    // Квартиры без жильцов: их привязывают проверяющие, по одному коду на
    // человека. Стояк 1 первого подъезда и второй подъезд свободны от аварий
    // посева, поэтому обращение отсюда заводится своей заявкой, а не склейкой.
    { id: 'apt-5', buildingId: BUILDING_ID, code: 'PRTM4837', number: 5, entrance: 1, riser: 1, area: 44, residents: 0 },
    { id: 'apt-7', buildingId: BUILDING_ID, code: 'CHWK7394', number: 7, entrance: 1, riser: 1, area: 38, residents: 0 },
    { id: 'apt-8', buildingId: BUILDING_ID, code: 'FNLA8473', number: 8, entrance: 1, riser: 1, area: 52, residents: 0 },
    { id: 'apt-9', buildingId: BUILDING_ID, code: 'MVXE3948', number: 9, entrance: 1, riser: 1, area: 41, residents: 0 },
    { id: 'apt-21', buildingId: BUILDING_ID, code: 'UYPC4739', number: 21, entrance: 2, riser: 1, area: 47, residents: 0 },
    { id: 'apt-22', buildingId: BUILDING_ID, code: 'RKAH9384', number: 22, entrance: 2, riser: 2, area: 36, residents: 0 },
    { id: 'apt-17-4', buildingId: 'dom17', code: 'VNAL7893', number: 4, entrance: 1, riser: 1, area: 62, residents: 2 },
    { id: 'apt-17-8', buildingId: 'dom17', code: 'CWHE4837', number: 8, entrance: 1, riser: 1, area: 48, residents: 1 },
  ],
  equipment: [
    { buildingId: BUILDING_ID, code: 'lift-1', title: 'Лифт, подъезд 1', kind: 'lift' },
    { buildingId: BUILDING_ID, code: 'lift-2', title: 'Лифт, подъезд 2', kind: 'lift' },
    { buildingId: BUILDING_ID, code: 'domofon-1', title: 'Домофон, подъезд 1', kind: 'intercom' },
    { buildingId: BUILDING_ID, code: 'uzel-1', title: 'Узел учёта тепла', kind: 'meter_unit' },
  ],
  residents: [
    {
      id: 'res-maria',
      maxUserId: 1001,
      displayName: 'Мария',
      role: 'resident',
      apartmentId: 'apt-1',
      apartmentIds: ['apt-1', 'apt-17-4'],
      buildingId: BUILDING_ID,
      language: 'ru',
    },
    {
      id: 'res-ivan',
      maxUserId: 1002,
      displayName: 'Иван',
      role: 'resident',
      apartmentId: 'apt-2',
      buildingId: BUILDING_ID,
      language: 'ru',
    },
    {
      id: 'staff-dispatcher',
      maxUserId: 2001,
      displayName: 'Ольга Титова',
      role: 'dispatcher',
      apartmentId: 'apt-17-8',
      apartmentIds: ['apt-17-8'],
      buildingId: BUILDING_ID,
      language: 'ru',
    },
    {
      id: 'staff-technician',
      maxUserId: 2002,
      displayName: 'Сергей Малых',
      role: 'technician',
      buildingId: BUILDING_ID,
      language: 'ru',
    },
    {
      id: 'staff-manager',
      maxUserId: 2003,
      displayName: 'Нина Гордеева',
      role: 'manager',
      buildingId: BUILDING_ID,
      language: 'ru',
    },
    {
      id: 'staff-contractor',
      maxUserId: 2004,
      displayName: 'Лифтсервис',
      role: 'contractor',
      buildingId: BUILDING_ID,
      language: 'ru',
    },
    {
      id: 'res-anna',
      maxUserId: 1003,
      displayName: 'Анна',
      role: 'resident',
      apartmentId: 'apt-3',
      buildingId: BUILDING_ID,
      language: 'ru',
    },
    {
      id: 'res-petr',
      maxUserId: 1004,
      displayName: 'Пётр',
      role: 'resident',
      apartmentId: 'apt-6',
      buildingId: BUILDING_ID,
      language: 'ru',
    },
  ],
});

export interface SeedOptions {
  /** Наполнить очередь заявками в разных состояниях. */
  withRequests?: boolean;
}

const START_VALUES = { cold_water: 120, hot_water: 64, electricity: 4300 } as const;
const MONTHLY = { cold_water: 3, hot_water: 2, electricity: 180 } as const;
const SEASONAL = [0, 0.8, 1.3, 1, 1.5, 1.1];
/** Сколько месяцев показаний заводится: из них и считается расход. */
const MONTHS_SHOWN = 6;

/**
 * Даты показаний считаются от сегодняшнего дня, а не задаются списком: иначе
 * набор стареет и последнее показание попадает в текущий расчётный период,
 * после чего демонстрация не даёт подать своё.
 */
/** День расчётного месяца: квитанция считается за месяц перед текущим окном подачи. */
const billedMonthDay = (now: Date, day: number, hour: number): Date => {
  const [year, month] = periodOf(now).split('-').map(Number);

  return new Date(Date.UTC(year!, (month ?? 1) - 2, day, hour));
};

const monthsOf = (now: Date, back: number): Date[] => {
  const period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Расчётный период начинается с окна подачи, а не с первого числа.
  if (now.getUTCDate() < READING_WINDOW.fromDay) period.setUTCMonth(period.getUTCMonth() - 1);

  period.setUTCMonth(period.getUTCMonth() - back);

  const last = new Date(
    Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), READING_WINDOW.fromDay + 2, 10),
  );

  return Array.from({ length: MONTHS_SHOWN }, (_, index) => {
    const at = new Date(last.getTime());

    at.setUTCMonth(at.getUTCMonth() - (MONTHS_SHOWN - 1 - index));

    return at;
  });
};
const SERIALS = { cold_water: 'ХВС', hot_water: 'ГВС', electricity: 'ЭЛ' } as const;
// Расход дома больше суммы квартирных: разница и есть общедомовое. Квартир
// в доме двенадцать, поэтому множители держат общедомовое положительным.
const HOUSE_FACTOR = { cold_water: 24, hot_water: 24, electricity: 14 } as const;

/** Полгода показаний по квартирам и по узлу учёта: из них считается квитанция. */
export const seedReadings = async (deps: AppDeps, data: DemoData): Promise<void> => {
  const { repository } = deps;

  // Своё показание жилец подаёт сам, поэтому последнее из заведённых за прошлый
  // период. Узел учёта снимает управляющая компания, у неё текущий период закрыт.
  const months = monthsOf(deps.now(), 1);
  const houseMonths = monthsOf(deps.now(), 0);

  for (const [residentId, apartmentId, until] of [
    ['res-maria', 'apt-1', months.length],
    ['res-ivan', 'apt-2', months.length],
    ['res-anna', 'apt-3', months.length],
    ['res-petr', 'apt-6', 2],
    ['staff-dispatcher', 'apt-10', months.length],
    ['staff-dispatcher', 'apt-20', months.length],
    // Свободные квартиры тоже с историей: проверяющий привязывается к любой
    // из них и сразу видит расход, квитанцию и отказ по заниженным цифрам.
    ['staff-dispatcher', 'apt-5', months.length],
    ['staff-dispatcher', 'apt-7', months.length],
    ['staff-dispatcher', 'apt-8', 2],
    ['staff-dispatcher', 'apt-9', months.length],
    ['staff-dispatcher', 'apt-21', months.length],
    ['staff-dispatcher', 'apt-22', months.length],
  ] as const) {
    for (const kind of ['cold_water', 'hot_water', 'electricity'] as const) {
      let value = START_VALUES[kind];

      for (const [index, month] of months.entries()) {
        value = Math.round((value + MONTHLY[kind] * (SEASONAL[index] ?? 1)) * 100) / 100;

        if (index >= until) continue;

        await repository.saveReading({
          id: `reading-${apartmentId}-${kind}-${index}`,
          meterId: `${kind}-${apartmentId}`,
          value,
          at: month,
          submittedBy: residentId,
        });
      }
    }
  }

  for (const kind of ['cold_water', 'hot_water', 'electricity'] as const) {
    await repository.saveHouseMeter({
      id: `house-${kind}`,
      buildingId: data.buildingId,
      kind,
      serial: `ОДПУ-${SERIALS[kind]}`,
      verifiedUntil: new Date(deps.now().getTime() + 3 * 365 * 24 * 3600_000),
    });

    let value = START_VALUES[kind] * 20;

    for (const [index, month] of houseMonths.entries()) {
      value = Math.round((value + MONTHLY[kind] * (SEASONAL[index] ?? 1) * HOUSE_FACTOR[kind]) * 100) / 100;

      await repository.saveHouseReading({
        id: `house-reading-${kind}-${index}`,
        meterId: `house-${kind}`,
        value,
        at: month,
        submittedBy: 'staff-dispatcher',
      });
    }
  }
};

/** Заполняет хранилище демонстрационными данными. */
export const seedDemo = async (deps: AppDeps, options: SeedOptions = {}): Promise<DemoData> => {
  const data = demoData();
  const { repository } = deps;

  // Оба дома ведёт одна организация: без общего владельца они считаются
  // домами разных компаний и в списке сотрудника остаётся только свой.
  const companyId = 'demo-uk';

  await repository.saveBuilding({
    id: data.buildingId,
    code: data.buildingCode,
    address: data.address,
    managementCompany: data.managementCompany,
    companyId,
    contact: data.contact,
    service: data.service,
    reception: data.reception,
    partners: data.partners,
  });

  await repository.saveBuilding({
    id: 'dom17',
    code: 'Д17',
    address: 'ул. Ленина, 17',
    managementCompany: data.managementCompany,
    companyId,
    contact: data.contact,
    service: data.service,
  });

  for (const apartment of data.apartments) await repository.saveApartment(apartment);
  for (const item of data.equipment) await repository.saveEquipment(item);
  // Заведённые в демонстрации люди уже пользуются продуктом, поэтому согласие
  // с документами у них есть: его показывают тому, кто пришёл впервые.
  for (const resident of data.residents) {
    await repository.saveResident({ ...resident, legalVersion: LEGAL_VERSION, legalAt: deps.now() });
  }

  for (const apartment of data.apartments) {
    for (const [kind, prefix] of [
      ['cold_water', 'ХВС'],
      ['hot_water', 'ГВС'],
      ['electricity', 'ЭЛ'],
    ] as const) {
      const day = 24 * 3600_000;
      const verifiedUntil = new Date(
        deps.now().getTime() + (kind === 'electricity' && apartment.number === 1 ? 40 * day : 3 * 365 * day),
      );

      await repository.saveMeter({
        id: `${kind}-${apartment.id}`,
        apartmentId: apartment.id,
        kind,
        serial: `${prefix}-${apartment.number}`,
        verifiedUntil,
      });
    }
  }

  const person = (id: string): Resident => data.residents.find((resident) => resident.id === id)!;

  const dispatcher = person('staff-dispatcher');

  // Отключение в расчётном месяце дольше нормы: в квитанции видна строка перерасчёта.
  const outageStart = billedMonthDay(deps.now(), 10, 6);

  await publishAnnouncement(deps, {
    resident: dispatcher,
    title: 'Отключение горячей воды',
    body: 'Ремонт на тепловой сети. Отключение с 06:00 до 20:00. Работы ведёт Теплосеть. По данным: Портал города.',
    works: {
      category: 'plumbing',
      from: outageStart,
      until: new Date(outageStart.getTime() + 14 * 3600_000),
      resource: 'hot_water',
    },
  });

  if (!options.withRequests) return data;

  const maria = person('res-maria');
  const ivan = person('res-ivan');

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  /** Те же сценарии, но в другой момент времени. */
  const at = (offsetMs: number): AppDeps => ({
    ...deps,
    now: () => new Date(deps.now().getTime() + offsetMs),
  });

  /** Проводит заявку до принятой жильцом: обычный путь, только в прошлом. */
  const settle = async (
    offsetMs: number,
    doneOffsetMs: number,
    description: string,
    startParam: string,
    category: RequestCategory,
  ) => {
    const created = await createServiceRequest(at(offsetMs), { resident: ivan, description, startParam, category });

    // Работа не может быть сдана раньше, чем её взяли: у заявок того же дня
    // сдача отодвигается за приём, иначе история идёт назад во времени.
    const finished = Math.max(doneOffsetMs, offsetMs + 2 * HOUR);

    await transitionRequest(at(offsetMs + 10 * MINUTE), {
      resident: dispatcher,
      requestId: created.id,
      to: 'accepted',
    });
    await transitionRequest(at(offsetMs + 40 * MINUTE), {
      resident: dispatcher,
      requestId: created.id,
      to: 'in_progress',
      assigneeId: 'staff-technician',
    });
    await transitionRequest(at(finished), {
      resident: person('staff-technician'),
      requestId: created.id,
      to: 'done',
      comment: 'Работа выполнена, проверено на месте',
    });
    await transitionRequest(at(finished + 3 * HOUR), {
      resident: ivan,
      requestId: created.id,
      to: 'confirmed',
    });
  };

  await settle(-40 * DAY, -40 * DAY, 'Не закрывается дверь во двор', 'ent_dom15_2', 'yard');
  await settle(-38 * DAY, -38 * DAY, 'Перегорела лампа в подъезде', 'ent_dom15_2', 'electricity');

  await settle(-20 * DAY, -17 * DAY, 'Не работает освещение во дворе', 'ent_dom15_2', 'electricity');

  const inTime = await createServiceRequest(at(-6 * DAY), {
    resident: maria,
    description: 'Скрипит дверь подъезда',
    startParam: 'ent_dom15_1',
  });

  await transitionRequest(at(-6 * DAY + 20 * MINUTE), {
    resident: dispatcher,
    requestId: inTime.id,
    to: 'accepted',
  });
  await transitionRequest(at(-6 * DAY + HOUR), {
    resident: dispatcher,
    requestId: inTime.id,
    to: 'in_progress',
    assigneeId: 'staff-technician',
  });
  await transitionRequest(at(-6 * DAY + 5 * HOUR), {
    resident: person('staff-technician'),
    requestId: inTime.id,
    to: 'done',
    comment: 'Прочистил сифон, вода уходит',
  });
  await transitionRequest(at(-5 * DAY), { resident: maria, requestId: inTime.id, to: 'confirmed' });

  const inProgress = await createServiceRequest(at(-5 * HOUR), {
    resident: ivan,
    description: 'Течёт кран на кухне, вода капает постоянно',
    startParam: 'apt_apt-2',
  });

  await transitionRequest(at(-5 * HOUR + 15 * MINUTE), {
    resident: dispatcher,
    requestId: inProgress.id,
    to: 'accepted',
  });
  await transitionRequest(at(-3 * HOUR), {
    resident: dispatcher,
    requestId: inProgress.id,
    to: 'in_progress',
    assigneeId: 'staff-technician',
  });

  for (const neighbour of ['res-anna', 'res-petr']) {
    await answerAlert(at(-2 * HOUR), {
      resident: data.residents.find((person) => person.id === neighbour)!,
      requestId: inProgress.id,
      affected: false,
    });
  }

  // Аварии заводятся так, чтобы в течение дня показа не краснеть: срок реакции
  // у лифта четыре минуты, поэтому заявка сразу принята и в работе у мастера.
  const stuck = await createServiceRequest(at(-10 * MINUTE), {
    resident: ivan,
    description: 'Застряли в лифте между третьим и четвёртым этажом',
    startParam: 'eqp_dom15_lift-1',
  });

  await transitionRequest(at(-8 * MINUTE), { resident: dispatcher, requestId: stuck.id, to: 'accepted' });
  await transitionRequest(at(-5 * MINUTE), {
    resident: dispatcher,
    requestId: stuck.id,
    to: 'in_progress',
    assigneeId: 'staff-technician',
  });

  const contracted = await createServiceRequest(at(-HOUR), {
    resident: maria,
    description: 'Лифт дёргается при закрытии дверей',
    startParam: 'eqp_dom15_lift-2',
  });

  await transitionRequest(at(-HOUR + 10 * MINUTE), {
    resident: dispatcher,
    requestId: contracted.id,
    to: 'accepted',
  });
  await transitionRequest(at(-40 * MINUTE), {
    resident: dispatcher,
    requestId: contracted.id,
    to: 'in_progress',
    assigneeId: 'staff-contractor',
  });

  const waiting = await createServiceRequest(at(-8 * HOUR), {
    resident: ivan,
    description: 'Нет горячей воды со вчерашнего вечера',
    startParam: 'rsr_dom15_1_2',
  });

  await transitionRequest(at(-8 * HOUR + 20 * MINUTE), {
    resident: dispatcher,
    requestId: waiting.id,
    to: 'accepted',
  });
  await transitionRequest(at(-6 * HOUR), {
    resident: dispatcher,
    requestId: waiting.id,
    to: 'needs_info',
    comment: 'У соседей по стояку вода есть?',
  });

  const joined = await submitProblem(at(-5 * HOUR), {
    resident: person('res-anna'),
    description: 'У нас тоже нет горячей воды',
  });

  if (joined.kind === 'planned') throw new Error('Обращение соседа неожиданно объяснилось плановыми работами');
  if (joined.kind === 'answered') throw new Error('Обращение соседа неожиданно оказалось вопросом');
  if (joined.kind === 'unclear') throw new Error('Обращение соседа неожиданно показалось непонятным');

  await answerAlert(at(-4 * HOUR), {
    resident: person('res-petr'),
    requestId: waiting.id,
    affected: false,
  });

  const accepting = await createServiceRequest(at(-2 * DAY), {
    resident: maria,
    description: 'Не горит лампа на площадке между вторым и третьим этажом',
    startParam: 'ent_dom15_1',
  });

  for (const [index, to] of (['accepted', 'in_progress'] as const).entries()) {
    await transitionRequest(at(-2 * DAY + (index + 1) * HOUR), {
      resident: dispatcher,
      requestId: accepting.id,
      to,
      ...(to === 'in_progress' ? { assigneeId: 'staff-technician' } : {}),
    });
  }

  await transitionRequest(at(-20 * HOUR), {
    resident: person('staff-technician'),
    requestId: accepting.id,
    to: 'done',
    comment: 'Лампа заменена',
  });

  const technician = person('staff-technician');

  const complaints = ['Лифт встал на пятом', 'Лифт снова не едет', 'Лифт дёргается при остановке'];

  for (const [index, complaint] of complaints.entries()) {
    const day = -(complaints.length - index) * 3 * DAY;

    const repeated = await createServiceRequest(at(day), {
      resident: ivan,
      description: complaint,
      startParam: 'eqp_dom15_lift-1',
    });

    await transitionRequest(at(day + 2 * MINUTE), { resident: dispatcher, requestId: repeated.id, to: 'accepted' });
    await transitionRequest(at(day + 10 * MINUTE), {
      resident: dispatcher,
      requestId: repeated.id,
      to: 'in_progress',
      assigneeId: technician.id,
    });
    await transitionRequest(at(day + 3 * HOUR), {
      resident: technician,
      requestId: repeated.id,
      to: 'done',
      comment: 'Поправил направляющие кабины',
    });
    await transitionRequest(at(day + 4 * HOUR), { resident: ivan, requestId: repeated.id, to: 'confirmed' });
  }

  const returned = await createServiceRequest(at(-2 * DAY), {
    resident: maria,
    description: 'Не работает домофон, трубка молчит',
    startParam: 'eqp_dom15_domofon-1',
  });

  await transitionRequest(at(-2 * DAY + HOUR), { resident: dispatcher, requestId: returned.id, to: 'accepted' });
  await transitionRequest(at(-2 * DAY + 2 * HOUR), {
    resident: dispatcher,
    requestId: returned.id,
    to: 'in_progress',
    assigneeId: technician.id,
  });
  await transitionRequest(at(-30 * HOUR), {
    resident: technician,
    requestId: returned.id,
    to: 'done',
    comment: 'Заменил трубку домофона',
  });
  await transitionRequest(at(-26 * HOUR), {
    resident: maria,
    requestId: returned.id,
    to: 'in_progress',
    comment: 'Трубка по-прежнему молчит',
  });

  await publishAnnouncement(deps, {
    resident: dispatcher,
    title: 'Собрание собственников',
    body:
      'Голосование по ремонту подъездов открыто в приложении, раздел «Собрания». ' +
      'Очное обсуждение сметы и тарифа на содержание в четверг в 19:00 во дворе.',
  });

  await publishAnnouncement(deps, {
    resident: dispatcher,
    title: 'Отключение горячей воды',
    body: 'Плановая замена запорной арматуры по стояку 2 первого подъезда.',
    entrance: 1,
    riser: 2,
    works: {
      category: 'plumbing',
      from: new Date(deps.now().getTime() - 2 * 3600_000),
      until: new Date(deps.now().getTime() + 3 * 3600_000),
    },
  });

  await publishAnnouncement(deps, {
    resident: dispatcher,
    title: 'Промывка системы отопления',
    body: 'Промывка по всему дому, батареи будут холодными.',
    works: {
      category: 'heating',
      from: new Date(deps.now().getTime() + 3 * DAY),
      until: new Date(deps.now().getTime() + 3 * DAY + 6 * 3600_000),
    },
  });

  await seedReadings(deps, data);

  const announced = await startPoll(deps, {
    resident: dispatcher,
    kind: 'qualified',
    title: 'Ремонт подъездов',
    question: 'Утвердить смету и порядок оплаты',
    days: 14,
  });

  // Собрание объявили полторы недели назад: сообщение разослано, голосование
  // уже идёт. Иначе в доме не было бы открытого собрания, а закон даёт десять
  // дней на сообщение собственникам.
  const meeting = await repository.savePoll({
    ...announced,
    opensAt: new Date(deps.now().getTime() - 3 * DAY),
    closesAt: new Date(deps.now().getTime() + 11 * DAY),
  });

  await vote(deps, { resident: ivan, pollId: meeting.id, choice: 'for' });

  // Рядом с собранием идёт опрос: он ничего не решает и сроков закона не имеет.
  const survey = await startPoll(deps, {
    resident: dispatcher,
    kind: 'simple',
    mode: 'survey',
    title: 'Уборка подъездов по субботам',
    question: 'Перенести влажную уборку подъездов на субботу',
    days: 7,
  });

  await vote(deps, { resident: maria, pollId: survey.id, choice: 'for' });

  await setDuty(at(-12 * HOUR), person('staff-manager'), { residentId: technician.id, onDuty: true });

  const past = await repository.savePoll({
    id: 'poll-past',
    buildingId: data.buildingId,
    kind: 'simple',
    title: 'Установка шлагбаума',
    question: 'Установить шлагбаум на въезде во двор',
    opensAt: new Date(deps.now().getTime() - 30 * DAY),
    closesAt: new Date(deps.now().getTime() - 2 * DAY),
    startedBy: dispatcher.id,
  });

  for (const [apartmentId, residentId, choice] of [
    ['apt-1', maria.id, 'for'],
    ['apt-2', ivan.id, 'for'],
    ['apt-3', person('res-anna').id, 'against'],
    ['apt-6', person('res-petr').id, 'for'],
  ] as const) {
    await repository.saveVote({
      pollId: past.id,
      apartmentId,
      choice,
      at: new Date(deps.now().getTime() - 5 * DAY),
      residentId,
    });
  }

  await closePoll(deps, past);

  const rounds = await planInspections(deps, data.buildingId);
  const entrance = rounds.find((round) => round.kind === 'entrance' && round.entrance === 1);

  if (entrance) {
    await checkInspectionItem(at(-15 * MINUTE), {
      resident: technician,
      inspectionId: entrance.id,
      index: 0,
      state: 'ok',
    });

    await checkInspectionItem(at(-10 * MINUTE), {
      resident: technician,
      inspectionId: entrance.id,
      index: 2,
      state: 'problem',
      comment: 'Перила расшатаны на площадке второго этажа',
    });
  }

  const answeredQuestion = await askSupport(at(-3 * DAY), {
    resident: maria,
    text: 'Как пересчитать плату за горячую воду, пока её не было двое суток?',
  });

  await answerSupport(at(-3 * DAY + 2 * HOUR), {
    staff: dispatcher,
    ticketId: answeredQuestion.id,
    text: 'Перерасчёт делаем по акту, он уже составлен. Сумма уйдёт в квитанцию следующего месяца.',
  });

  await askSupport(at(-40 * MINUTE), {
    resident: person('res-anna'),
    text: 'Можно поставить лавочку у второго подъезда? Соседи не против.',
  });

  return { ...data, joinedRequestNumber: joined.request.number, reporters: joined.reporters };
};
