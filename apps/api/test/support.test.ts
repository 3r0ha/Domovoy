import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, createCollectingNotifier, type Resident } from '@domovoy/app';
import { signInitData } from '@maxkit/bridge';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'api-bot-token';
const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const ivan: Resident = {
  id: 'res-ivan',
  maxUserId: 1002,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга Титова',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const manager: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

const initDataFor = (userId: number): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `q-${userId}`,
      user: JSON.stringify({ id: userId }),
    },
    BOT_TOKEN,
  );

const setup = async () => {
  let counter = 0;

  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
    apartments: [
      { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
      { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 50 },
    ],
    residents: [maria, ivan, dispatcher, manager],
  });

  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository,
    defaultBuildingId: BUILDING_ID,
    createId: () => `id-${++counter}`,
    now: () => new Date('2026-09-07T10:00:00Z'),
    notifier: createCollectingNotifier(),
  });

  const login = async (userId: number): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(userId) },
    });

    return response.json<{ token: string }>().token;
  };

  return { app, login, repository };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

interface Ticket {
  id: string;
  subject: string;
  status: string;
  statusTitle: string;
  messages: { from: string; text: string; own?: boolean; authorName?: string }[];
}

describe('поддержка по HTTP', () => {
  it('жилец спрашивает, смена отвечает, переписка видна обоим', async () => {
    const { app, login } = await setup();
    const resident = await login(1001);
    const staff = await login(5005);

    const asked = await app.inject({
      method: 'POST',
      url: '/api/support',
      headers: authed(resident),
      payload: { text: 'Когда включат отопление?' },
    });

    assert.equal(asked.statusCode, 200);

    const ticket = asked.json<Ticket>();

    assert.equal(ticket.status, 'open');
    assert.equal(ticket.statusTitle, 'ждёт ответа');

    const answered = await app.inject({
      method: 'POST',
      url: `/api/support/${ticket.id}/answer`,
      headers: authed(staff),
      payload: { text: 'Тепло подадим 25 сентября.' },
    });

    assert.equal(answered.statusCode, 200);
    assert.equal(answered.json<Ticket>().status, 'answered');

    const mine = await app.inject({ method: 'GET', url: '/api/support', headers: authed(resident) });
    const [first] = mine.json<Ticket[]>();

    assert.equal(first?.messages.length, 2);
    assert.equal(first?.messages[1]?.authorName, 'Ольга Титова');
    assert.equal(first?.messages[0]?.own, true, 'своё сообщение подписано «Вы»');

    await app.close();
  });

  it('чужое обращение не отдаётся соседу', async () => {
    const { app, login } = await setup();

    const asked = await app.inject({
      method: 'POST',
      url: '/api/support',
      headers: authed(await login(1001)),
      payload: { text: 'Вопрос про квитанцию' },
    });

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/support/${asked.json<Ticket>().id}`,
      headers: authed(await login(1002)),
    });

    assert.equal(foreign.statusCode, 403);

    await app.close();
  });

  it('смена видит вопросы дома и счётчик ожидающих', async () => {
    const { app, login } = await setup();

    await app.inject({
      method: 'POST',
      url: '/api/support',
      headers: authed(await login(1001)),
      payload: { text: 'Вопрос Марии' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/support',
      headers: authed(await login(1002)),
      payload: { text: 'Вопрос Ивана' },
    });

    const staff = await login(5005);
    const list = await app.inject({ method: 'GET', url: '/api/support', headers: authed(staff) });
    const waiting = await app.inject({ method: 'GET', url: '/api/support/waiting', headers: authed(staff) });

    assert.equal(list.json<Ticket[]>().length, 2);
    assert.equal(waiting.json<{ waiting: number }>().waiting, 2);

    await app.close();
  });

  it('снятый вопрос закрывается и больше не принимает сообщений', async () => {
    const { app, login } = await setup();
    const resident = await login(1001);

    const asked = await app.inject({
      method: 'POST',
      url: '/api/support',
      headers: authed(resident),
      payload: { text: 'Разобрался сам' },
    });

    const id = asked.json<Ticket>().id;
    const closed = await app.inject({ method: 'POST', url: `/api/support/${id}/close`, headers: authed(resident) });

    assert.equal(closed.json<Ticket>().status, 'closed');

    const again = await app.inject({
      method: 'POST',
      url: '/api/support',
      headers: authed(resident),
      payload: { text: 'ещё сообщение', ticketId: id },
    });

    assert.equal(again.statusCode, 409);

    await app.close();
  });
});

describe('контакты дома по HTTP', () => {
  it('управляющий вписывает ответственного, жилец его видит', async () => {
    const { app, login } = await setup();

    const saved = await app.inject({
      method: 'POST',
      url: '/api/buildings/card',
      headers: authed(await login(7007)),
      payload: {
        contact: {
          name: 'Гордеева Нина Павловна',
          role: 'управляющая домом',
          phone: '+7 900 120-45-15',
          email: 'nina@uk.ru',
        },
      },
    });

    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json<{ contact?: { name: string } }>().contact?.name, 'Гордеева Нина Павловна');

    const contacts = await app.inject({
      method: 'GET',
      url: '/api/house/contacts',
      headers: authed(await login(1001)),
    });

    const seen = contacts.json<{ address: string; contact?: { phone?: string; email?: string } }>();

    assert.equal(seen.address, 'ул. Ленина, 15');
    assert.equal(seen.contact?.phone, '+7 900 120-45-15');
    assert.equal(seen.contact?.email, 'nina@uk.ru');

    await app.close();
  });

  it('аварийная служба и приём приходят жильцу вместе с контактами', async () => {
    const { app, login } = await setup();

    const saved = await app.inject({
      method: 'POST',
      url: '/api/buildings/card',
      headers: authed(await login(7007)),
      payload: {
        service: {
          emergencyPhone: '+7 900 120-00-15',
          phone: '+7 900 120-45-00',
          hours: 'пн-пт 9:00-18:00',
          office: 'ул. Ленина, 15, офис 1',
          officeHours: 'вт и чт 15:00-19:00',
        },
      },
    });

    assert.equal(saved.statusCode, 200);

    const contacts = await app.inject({
      method: 'GET',
      url: '/api/house/contacts',
      headers: authed(await login(1001)),
    });

    const seen = contacts.json<{ service?: { emergencyPhone?: string; office?: string; hours?: string } }>();

    assert.equal(seen.service?.emergencyPhone, '+7 900 120-00-15');
    assert.equal(seen.service?.hours, 'пн-пт 9:00-18:00');
    assert.equal(seen.service?.office, 'ул. Ленина, 15, офис 1');

    await app.close();
  });

  it('почта с опечаткой не принимается', async () => {
    const { app, login } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/api/buildings/card',
      headers: authed(await login(7007)),
      payload: { contact: { name: 'Нина', email: 'нина собака почта' } },
    });

    assert.equal(response.statusCode, 400);

    await app.close();
  });

  it('карточку дома ведёт управляющий, а не диспетчер', async () => {
    const { app, login } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/api/buildings/card',
      headers: authed(await login(5005)),
      payload: { contact: { name: 'Ольга' } },
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });
});
