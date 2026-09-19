import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createServiceRequest,
  doingFor,
  transitionRequest,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const pavel: Resident = {
  id: 'res-2',
  maxUserId: 1002,
  displayName: 'Павел',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const technician: Resident = {
  id: 'tech-1',
  maxUserId: 2002,
  displayName: 'Сергей',
  role: 'technician',
  buildingId: BUILDING_ID,
};

const setup = (): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 1, area: 50 },
      ],
      residents: [maria, pavel, dispatcher, technician],
    }),
    now: () => new Date('2026-09-22T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
  };
};

/** Заявка, доведённая до работы мастера. */
const inWork = async (deps: AppDeps, description = 'Течёт труба под раковиной'): Promise<string> => {
  const created = await createServiceRequest(deps, {
    resident: maria,
    description,
    category: 'plumbing',
    startParam: 'apt_apt-1',
  });

  await transitionRequest(deps, { resident: dispatcher, requestId: created.id, to: 'accepted' });
  await transitionRequest(deps, {
    resident: dispatcher,
    requestId: created.id,
    to: 'in_progress',
    assigneeId: technician.id,
  });

  return created.id;
};

describe('дела словами', () => {
  it('слова мастера о работе становятся сдачей наряда', async () => {
    const deps = setup();
    const id = await inWork(deps);

    const doing = await doingFor(deps, technician, 'починил трубу, заменил подводку');

    assert.equal(doing?.kind, 'transition');
    assert.equal(doing?.kind === 'transition' ? doing.to : '', 'done');
    assert.equal(doing?.kind === 'transition' ? doing.request?.id : '', id);
    assert.equal(doing?.kind === 'transition' ? doing.comment : '', 'починил трубу, заменил подводку');
    assert.equal(doing?.kind === 'transition' ? doing.requiresComment : false, true);
  });

  it('те же слова у жильца значат приёмку, а не сдачу', async () => {
    const deps = setup();
    const id = await inWork(deps);

    await transitionRequest(deps, {
      resident: technician,
      requestId: id,
      to: 'done',
      comment: 'Труба заменена',
    });

    const doing = await doingFor(deps, maria, 'всё сделали, спасибо');

    assert.equal(doing?.kind === 'transition' ? doing.to : '', 'confirmed');
    assert.equal(doing?.kind === 'transition' ? doing.request?.id : '', id);
  });

  it('номер внутри фразы снимает выбор', async () => {
    const deps = setup();

    await inWork(deps, 'Течёт труба в подвале');

    const second = await inWork(deps, 'Не работает свет в подъезде');
    const number = (await deps.repository.findRequest(second))!.number;

    const doing = await doingFor(deps, technician, `по ${number} всё готово`);

    assert.equal(doing?.kind === 'transition' ? doing.request?.id : '', second, 'номер не узнан');
  });

  it('хвоста номера тоже хватает', async () => {
    const deps = setup();

    await inWork(deps, 'Течёт труба в подвале');

    const second = await inWork(deps, 'Не работает свет в подъезде');
    const tail = (await deps.repository.findRequest(second))!.number.slice(-4);

    const doing = await doingFor(deps, technician, `${tail} сделал`);

    assert.equal(doing?.kind === 'transition' ? doing.request?.id : '', second);
  });

  it('когда нарядов несколько, выбор остаётся за человеком', async () => {
    const deps = setup();

    await inWork(deps, 'Течёт труба в подвале');
    await inWork(deps, 'Не работает свет в подъезде');

    const doing = await doingFor(deps, technician, 'сделал');

    assert.equal(doing?.kind === 'transition' ? doing.request : 'есть', undefined, 'заявку выбрали за человека');
    assert.equal(doing?.kind === 'transition' ? doing.choices.length : 0, 2);
  });

  it('дело не по правам объясняется, а не превращается в заявку', async () => {
    const deps = setup();

    await inWork(deps);

    const doing = await doingFor(deps, maria, 'отклоняю заявку, это не ваша зона');

    assert.equal(doing?.kind, 'denied');
    assert.match(doing?.kind === 'denied' ? doing.reason : '', /управляющая организация/);
  });

  it('снять обращение может только тот, кто его подал', async () => {
    const deps = setup();

    await createServiceRequest(deps, { resident: maria, description: 'Разбито стекло в подъезде' });

    const doing = await doingFor(deps, pavel, 'уже не нужно, снимаю заявку');

    assert.equal(doing?.kind, 'denied', 'сосед снял чужое обращение');
  });

  it('вопрос делом не становится', async () => {
    const deps = setup();

    await inWork(deps);

    assert.equal(await doingFor(deps, technician, 'когда починят трубу?'), undefined);
    assert.equal(await doingFor(deps, maria, 'всё сделали или нет?'), undefined);
  });

  it('смена работает с очередью дома, а не только со своими заявками', async () => {
    const deps = setup();

    await createServiceRequest(deps, { resident: maria, description: 'Нет света в подъезде' });

    const doing = await doingFor(deps, dispatcher, 'беру заявку в работу');

    assert.equal(doing?.kind === 'transition' ? doing.to : '', 'accepted');
  });

  it('модель узнаёт дело, которого нет в словаре слов', async () => {
    const deps = setup();
    const id = await inWork(deps);

    // Слова «протечку ликвидировал» в словаре не описаны: их разбирает модель.
    const doing = await doingFor(
      { ...deps, reasoner: { understand: () => Promise.resolve(undefined), doing: () => Promise.resolve({ deed: 'done' }) } },
      technician,
      'протечку ликвидировал, всё сухо',
    );

    assert.equal(doing?.kind === 'transition' ? doing.to : '', 'done');
    assert.equal(doing?.kind === 'transition' ? doing.request?.id : '', id);
  });

  it('модель прав не добавляет: чужое дело отбрасывается', async () => {
    const deps = setup();

    await inWork(deps);

    // Модель называет дело смены, а спрашивает жилец: продукт её не слушает.
    const doing = await doingFor(
      {
        ...deps,
        reasoner: { understand: () => Promise.resolve(undefined), doing: () => Promise.resolve({ deed: 'reject' }) },
      },
      maria,
      'тут всё понятно',
    );

    assert.equal(doing, undefined);
  });

  it('выдуманный моделью номер заявкой не становится', async () => {
    const deps = setup();
    const id = await inWork(deps);

    const doing = await doingFor(
      {
        ...deps,
        reasoner: {
          understand: () => Promise.resolve(undefined),
          doing: () => Promise.resolve({ deed: 'done', number: 'Д99-9999-9999' }),
        },
      },
      technician,
      'сделал',
    );

    assert.equal(doing?.kind === 'transition' ? doing.request?.id : '', id, 'чужой номер увёл дело не туда');
  });

  it('поручение по имени выбирает и заявку, и мастера', async () => {
    const deps = setup();

    const created = await createServiceRequest(deps, { resident: maria, description: 'Нет света в подъезде' });
    const number = (await deps.repository.findRequest(created.id))!.number;

    const doing = await doingFor(deps, dispatcher, `назначь Сергея на ${number.slice(-4)}`);

    assert.equal(doing?.kind, 'assign');
    assert.equal(doing?.kind === 'assign' ? doing.request?.id : '', created.id);
    assert.equal(doing?.kind === 'assign' ? doing.staff?.id : '', technician.id);
  });

  it('без имени поручение оставляет выбор мастера кнопкой', async () => {
    const deps = setup();

    const created = await createServiceRequest(deps, { resident: maria, description: 'Нет света в подъезде' });

    const doing = await doingFor(deps, dispatcher, 'поручи кому-нибудь');

    assert.equal(doing?.kind === 'assign' ? doing.request?.id : '', created.id);
    assert.equal(doing?.kind === 'assign' ? doing.staff : 'есть', undefined);
    assert.equal(doing?.kind === 'assign' ? doing.candidates.length : 0, 1);
  });

  it('поручать наряды жилец не может', async () => {
    const deps = setup();

    await createServiceRequest(deps, { resident: maria, description: 'Нет света в подъезде' });

    assert.equal(await doingFor(deps, maria, 'назначьте Сергея на эту заявку'), undefined);
  });

  it('рассказ о поломке модель не беспокоит', async () => {
    const deps = setup();

    await inWork(deps);

    let asked = 0;

    const doing = await doingFor(
      {
        ...deps,
        reasoner: {
          understand: () => Promise.resolve(undefined),
          doing: () => {
            asked += 1;

            return Promise.resolve({ deed: 'done' });
          },
        },
      },
      technician,
      'в подъезде опять мусор у бака',
    );

    assert.equal(asked, 0, 'о поломке спросили модель');
    assert.equal(doing, undefined);
  });

  it('отказ объясняется делом той роли, которая спросила', async () => {
    const deps = setup();

    await inWork(deps);

    const doing = await doingFor(deps, maria, 'всё сделали, спасибо');

    // «Сделали» есть и в сдаче работы, и в её приёмке: жильцу отказ нужен про приёмку.
    assert.equal(doing?.kind, 'denied');
    assert.match(doing?.kind === 'denied' ? doing.reason : '', /Принять работу/);
  });

  it('просьба починить делом не считается', async () => {
    const deps = setup();

    await inWork(deps);

    assert.equal(await doingFor(deps, maria, 'когда почините стояк, сколько можно ждать'), undefined);
  });

  it('слов о деле нет, значит дела нет', async () => {
    const deps = setup();

    await inWork(deps);

    assert.equal(await doingFor(deps, technician, 'в подъезде опять мусор у бака'), undefined);
  });
});
