import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  asRequest,
  InMemoryRepository,
  buildingReport,
  createServiceRequest,
  exportRequests,
  formatReport,
  listAssignable,
  submitProblem,
  summariseReport,
  transitionRequest,
  type AppDeps,
  type Reasoner,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const START = new Date('2026-09-03T10:00:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
  { id: 'apt-3', buildingId: BUILDING_ID, number: 3, entrance: 1, riser: 1 },
];

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const pavel: Resident = {
  id: 'res-pavel',
  maxUserId: 1003,
  displayName: 'Павел',
  role: 'resident',
  apartmentId: 'apt-3',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга, диспетчер',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const technician: Resident = {
  id: 'tech-1',
  maxUserId: 6006,
  displayName: 'Сергей, мастер',
  role: 'technician',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { advance: (ms: number) => void };

const setup = (): Deps => {
  let counter = 0;
  let clock = START.getTime();

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: APARTMENTS,
      residents: [maria, pavel, dispatcher, technician],
    }),
    now: () => new Date(clock),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    advance: (ms) => {
      clock += ms;
    },
  };
};

/** Проводит заявку до «выполнено» назначенным мастером. */
const untilDone = async (deps: Deps, id: string): Promise<void> => {
  await transitionRequest(deps, { resident: dispatcher, requestId: id, to: 'accepted' });
  await transitionRequest(deps, {
    resident: dispatcher,
    requestId: id,
    to: 'in_progress',
    assigneeId: technician.id,
  });
  await transitionRequest(deps, { resident: technician, requestId: id, to: 'done' });
};

describe('сводка для управляющей компании', () => {
  it('жильцу не показывается', async () => {
    const deps = setup();

    await assert.rejects(buildingReport(deps, maria), /доступна сотрудникам/);
  });

  it('собирает то, чего не видно в списке заявок', async () => {
    const deps = setup();

    const incident = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));

    const returned = await createServiceRequest(deps, {
      resident: maria,
      description: 'Не горит лампа',
      startParam: 'ent_b1_1',
    });

    await untilDone(deps, returned.id);
    await transitionRequest(deps, {
      resident: maria,
      requestId: returned.id,
      to: 'in_progress',
      comment: 'Так и не горит',
    });

    deps.advance(100 * HOUR);

    const report = await buildingReport(deps, dispatcher);

    assert.equal(report.summary.total, 2);
    assert.equal(report.summary.mergedReports, 1, 'одно обращение не стало отдельной заявкой');
    assert.equal(report.summary.overdue, 2);

    assert.deepEqual(
      report.incidents.map((item) => ({ number: item.number, reporters: item.reporters })),
      [{ number: incident.request.number, reporters: 2 }],
    );

    assert.equal(report.assignees[0]?.displayName, 'Сергей, мастер', 'в отчёте имя, а не идентификатор');
    assert.equal(report.assignees[0]?.reopened, 1);
  });

  it('проблемные объекты появляются с третьей поломки', async () => {
    const deps = setup();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const created = await createServiceRequest(deps, {
        resident: maria,
        description: 'Лифт снова встал',
        startParam: 'eqp_b1_lift-1',
      });

      await untilDone(deps, created.id);
      await transitionRequest(deps, { resident: maria, requestId: created.id, to: 'confirmed' });
      deps.advance(HOUR);
    }

    const report = await buildingReport(deps, dispatcher);

    assert.equal(report.objects[0]?.title, 'оборудование lift-1');
    assert.equal(report.objects[0]?.requests, 3);
  });

  it('исполнители предлагаются по возрастанию загрузки', async () => {
    const deps = setup();

    const busy = await createServiceRequest(deps, {
      resident: maria,
      description: 'Течёт кран',
      startParam: 'apt_apt-1',
    });

    await transitionRequest(deps, { resident: dispatcher, requestId: busy.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: busy.id,
      to: 'in_progress',
      assigneeId: technician.id,
    });

    const staff = await listAssignable(deps, dispatcher);

    assert.deepEqual(
      staff.map((person) => ({ name: person.displayName, load: person.load })),
      [
        { name: 'Ольга, диспетчер', load: 0 },
        { name: 'Сергей, мастер', load: 1 },
      ],
    );
  });

  it('закрытая заявка загрузку не создаёт', async () => {
    const deps = setup();

    const created = await createServiceRequest(deps, {
      resident: maria,
      description: 'Течёт кран',
      startParam: 'apt_apt-1',
    });

    await untilDone(deps, created.id);

    const staff = await listAssignable(deps, dispatcher);

    assert.equal(staff.find((person) => person.id === technician.id)?.load, 0);
  });

  it('жилец список исполнителей не получает', async () => {
    const deps = setup();

    await assert.rejects(listAssignable(deps, maria), /только управляющая компания/);
  });

  it('текст для чата начинается с того, что горит', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));
    deps.advance(100 * HOUR);

    const text = formatReport(await buildingReport(deps, dispatcher));

    assert.match(text, /^Сейчас: открыто 1, из них просрочено 1\./);
    assert.match(text, /За 30 дн\.: подано 1 \(было 0\), закрыто 0\./);
    assert.match(text, /Обращений присоединено к существующим заявкам: 1/);
    assert.match(text, /Аварии с несколькими обращениями:/);
    assert.match(text, /сообщили 2/);
    assert.match(text, /Водоснабжение и канализация: 1 из 1 \(100%\)/);
  });

  it('в тексте для чата есть возвраты и проблемные объекты', async () => {
    const deps = setup();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const created = await createServiceRequest(deps, {
        resident: maria,
        description: 'Лифт снова встал',
        startParam: 'eqp_b1_lift-1',
      });

      await untilDone(deps, created.id);

      if (attempt === 0) {
        await transitionRequest(deps, {
          resident: maria,
          requestId: created.id,
          to: 'in_progress',
          comment: 'Всё так же стоит',
        });
      } else {
        await transitionRequest(deps, { resident: maria, requestId: created.id, to: 'confirmed' });
      }

      deps.advance(HOUR);
    }

    const text = formatReport(await buildingReport(deps, dispatcher));

    assert.match(text, /Работы, которые жильцы не приняли:/);
    assert.match(text, /Сергей, мастер: 1 из 3 \(33%\)/);
    assert.match(text, /Ломается чаще прочего:/);
    assert.match(text, /оборудование lift-1: обращений 3/);
  });

  it('пустой дом даёт короткую сводку без пустых разделов', async () => {
    const deps = setup();
    const text = formatReport(await buildingReport(deps, dispatcher));

    assert.equal(
      text,
      ['Сейчас: открыто 0, из них просрочено 0.', '', 'За 30 дн.: подано 0 (было 0), закрыто 0.'].join('\n'),
    );
  });

  it('сводка считается за период, а не за всё время', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    deps.advance(40 * DAY);

    const report = await buildingReport(deps, dispatcher);

    assert.equal(report.summary.total, 1, 'заявка никуда не делась');
    assert.equal(report.summary.open, 1);
    assert.equal(report.period.created, 0, 'подана раньше окна');
    assert.equal(report.previous.created, 1, 'зато попала в прошлый период');
  });

  it('нарушенный норматив виден в сводке и после закрытия заявки', async () => {
    const deps = setup();

    const created = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });

    deps.advance(3 * DAY);
    await untilDone(deps, created.id);

    const report = await buildingReport(deps, dispatcher);

    assert.equal(report.summary.overdue, 0, 'сейчас ничего не горит');
    assert.equal(report.period.missed, 1, 'но норматив был нарушен');
    assert.equal(report.period.inTimeRate, 0);
    assert.deepEqual(
      report.categories.map((category) => [category.category, category.overdue]),
      [['plumbing', 1]],
    );
  });

  it('реестр заявок выгружается таблицей', async () => {
    const deps = setup();

    const created = await createServiceRequest(deps, {
      resident: maria,
      description: 'Течёт "кран"; сильно',
      apartmentId: 'apt-1',
    });

    await untilDone(deps, created.id);

    const { filename, csv } = await exportRequests(deps, dispatcher);
    const [header, first] = csv.split('\r\n');

    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.match(header ?? '', /Номер;Категория;Объект/);

    assert.match(first ?? '', /"Течёт ""кран""; сильно"/);
    assert.match(first ?? '', /квартира 1/);
    assert.match(first ?? '', /Сергей, мастер/);
    assert.match(filename, /^заявки-b1-\d{4}-\d{2}-\d{2}/);
  });

  it('оценка попадает в реестр, а её отсутствие не превращается в ноль', async () => {
    const deps = setup();

    const rated = await createServiceRequest(deps, { resident: maria, description: 'Оценённая' });
    const silent = await createServiceRequest(deps, { resident: maria, description: 'Молча принятая' });

    await untilDone(deps, rated.id);
    await untilDone(deps, silent.id);
    await transitionRequest(deps, { resident: maria, requestId: rated.id, to: 'confirmed', rating: 5 });
    await transitionRequest(deps, { resident: maria, requestId: silent.id, to: 'confirmed' });

    const { csv } = await exportRequests(deps, dispatcher);
    const rows = csv.split('\r\n');

    assert.match(rows.find((row) => row.includes('Оценённая')) ?? '', /;5;Оценённая/);
    assert.match(rows.find((row) => row.includes('Молча принятая')) ?? '', /;;Молча принятая/);
    assert.match(rows[0] ?? '', /Оценка;Описание/);
  });

  it('жильцу выгрузка недоступна', async () => {
    const deps = setup();

    await assert.rejects(exportRequests(deps, maria), /доступна сотрудникам/);
  });

  it('в выгрузку попадают только заявки периода', async () => {
    const deps = setup();

    await createServiceRequest(deps, { resident: maria, description: 'Старая заявка' });
    deps.advance(40 * DAY);
    await createServiceRequest(deps, { resident: maria, description: 'Свежая заявка' });

    const { csv } = await exportRequests(deps, dispatcher);

    assert.match(csv, /Свежая заявка/);
    assert.doesNotMatch(csv, /Старая заявка/);
  });

  it('период задаётся вызывающим', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    deps.advance(40 * DAY);

    const quarter = await buildingReport(deps, dispatcher, 90);

    assert.equal(quarter.period.created, 1, 'за квартал заявка попадает в окно');
  });

  it('пересказ сводки словами приходит от модели и обрезается по длине', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    const report = await buildingReport(deps, dispatcher);

    const model: Reasoner = {
      understand: async () => undefined,
      digest: async () => '  За неделю подано 1 обращение, просрочек нет.  ',
    };

    assert.equal(await summariseReport(report, model), 'За неделю подано 1 обращение, просрочек нет.');

    const chatty: Reasoner = {
      understand: async () => undefined,
      digest: async () => 'а'.repeat(500),
    };

    assert.equal(await summariseReport(report, chatty), undefined, 'слишком длинный пересказ не показываем');

    const inventing: Reasoner = {
      understand: async () => undefined,
      digest: async () => 'За период подано 17 обращений.',
    };

    assert.equal(await summariseReport(report, inventing), undefined, 'число из ниоткуда в пересказ не проходит');
  });

  it('пересказ не выдаёт просроченные работы за сделанные вовремя', async () => {
    const deps = setup();
    const late = asRequest(await submitProblem(deps, { resident: maria, description: 'Не горит лампа' }));

    if (late.kind !== 'created') throw new Error('заявка не завелась');

    // Заявка закрывается уже после срока: доля «в срок» перестаёт быть стопроцентной.
    await transitionRequest(deps, { resident: dispatcher, requestId: late.request.id, to: 'accepted' });
    await transitionRequest(deps, { resident: dispatcher, requestId: late.request.id, to: 'in_progress' });
    deps.advance(5 * 24 * 60 * 60 * 1000);
    await transitionRequest(deps, { resident: dispatcher, requestId: late.request.id, to: 'done' });
    await transitionRequest(deps, { resident: maria, requestId: late.request.id, to: 'confirmed' });

    const report = await buildingReport(deps, dispatcher);

    assert.ok(report.period.inTimeRate < 1, 'в срок закрыто не всё');

    const rosy: Reasoner = {
      understand: async () => undefined,
      digest: async () => 'Все заявки закрыты вовремя.',
    };

    assert.equal(await summariseReport(report, rosy), undefined, 'пересказ разошёлся со сводкой');
  });

  it('без модели и при её отказе сводка остаётся прежней', async () => {
    const deps = setup();
    const report = await buildingReport(deps, dispatcher);

    assert.equal(await summariseReport(report), undefined);

    const broken: Reasoner = {
      understand: async () => undefined,
      digest: () => Promise.reject(new Error('нет связи')),
    };

    assert.equal(await summariseReport(report, broken), undefined);
    assert.match(formatReport(report), /Сейчас: открыто/);
  });
});
