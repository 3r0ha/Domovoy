import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '@domovoy/domain';

import {
  type AppDeps,
  InMemoryRepository,
  VIEW_JOURNAL_MINUTES,
  activeGuestCodes,
  createMockHub,
  revokeGuestCode,
  devicesAt,
  devicesFor,
  inviteGuest,
  journalFor,
  openByCode,
  openDevice,
  viewDevice,
  type Device,
  type Notification,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-05T10:00:00Z');

const DEVICES: Device[] = [
  { id: 'intercom-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 },
  { id: 'camera-1', buildingId: BUILDING_ID, kind: 'camera', title: 'Камера у подъезда 1', entrance: 1 },
  { id: 'intercom-2', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 2', entrance: 2 },
  { id: 'barrier-1', buildingId: BUILDING_ID, kind: 'barrier', title: 'Шлагбаум во двор' },
  { id: 'alien', buildingId: 'b2', kind: 'intercom', title: 'Домофон чужого дома', entrance: 1 },
];

const setup = () => {
  const hub = createMockHub({ devices: DEVICES, now: () => NOW, createCode: () => '123456' });
  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
    apartments: [
      { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
      { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
      { id: 'apt-20', buildingId: BUILDING_ID, number: 20, entrance: 2, riser: 1 },
    ],
  });
  const sent: Notification[] = [];

  return {
    hub,
    sent,
    repository,
    deps: {
      hub,
      repository,
      now: () => NOW,
      createId: () => 'id-1',
      defaultBuildingId: BUILDING_ID,
      notifier: {
        async send(notification: Notification) {
          sent.push(notification);
        },
      },
    },
  };
};

const resident = (overrides: Partial<Resident> = {}): Resident => ({
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
  ...overrides,
});

describe('оборудование дома', () => {
  it('жилец видит свой подъезд и общедомовое', () => {
    const { deps } = setup();

    return devicesFor(deps, resident(), 1).then((devices) => {
      assert.deepEqual(
        devices.map((device) => device.id),
        ['intercom-1', 'camera-1', 'barrier-1'],
      );
    });
  });

  it('сотруднику видно всё оборудование дома', async () => {
    const { deps } = setup();

    const devices = await devicesFor(deps, resident({ role: 'technician', apartmentId: undefined }), undefined);

    assert.equal(devices.length, 4, 'чужой дом всё равно не показывается');
    assert.equal(devices.some((device) => device.id === 'alien'), false);
  });

  it('без подключённого оборудования список пуст, а не сломан', async () => {
    assert.deepEqual(await devicesFor({ now: () => NOW }, resident(), 1), []);
  });

  it('по коду с наклейки видно оборудование этого подъезда', async () => {
    const { deps } = setup();

    const devices = await devicesAt(deps, BUILDING_ID, { kind: 'entrance', buildingId: BUILDING_ID, entrance: 2 });

    assert.deepEqual(
      devices.map((device) => device.id),
      ['intercom-2'],
    );
  });

  it('дверь открывается и оставляет след', async () => {
    const { hub, deps } = setup();

    const device = await openDevice(deps, resident(), 'intercom-1');

    assert.equal(device.title, 'Домофон, подъезд 1');
    assert.deepEqual(hub.events, [
      { deviceId: 'intercom-1', at: NOW, action: 'opened', by: 'resident', residentId: 'res-1' },
    ]);
  });

  it('камеру не открывают, а домофон не показывает картинку', async () => {
    const { deps } = setup();

    await assert.rejects(openDevice(deps, resident(), 'camera-1'), DomainError);
    await assert.rejects(viewDevice(deps, resident(), 'intercom-1'), DomainError);
  });

  it('чужое устройство не открыть', async () => {
    const { deps } = setup();

    await assert.rejects(openDevice(deps, resident(), 'alien'), /не найдено/);
  });

  it('соседний подъезд жильцу закрыт, даже если он знает идентификатор', async () => {
    const { deps } = setup();
    const mine = resident();
    const neighbour = resident({ id: 'res-3', maxUserId: 1020, apartmentId: 'apt-20' });

    await assert.rejects(openDevice(deps, mine, 'intercom-2'), /не найдено/);
    await assert.rejects(viewDevice(deps, neighbour, 'camera-1'), /не найдено/);
    await assert.rejects(inviteGuest(deps, mine, 'intercom-2'), /не найдено/);

    assert.equal((await openDevice(deps, neighbour, 'intercom-2')).id, 'intercom-2', 'свой подъезд открывается');
    assert.equal((await openDevice(deps, mine, 'barrier-1')).id, 'barrier-1', 'общедомовое общее');

    const staff = resident({ id: 'tech-1', maxUserId: 2002, role: 'technician', apartmentId: undefined });

    assert.equal((await openDevice(deps, staff, 'intercom-2')).id, 'intercom-2', 'смене открыт весь дом');
  });

  it('кадр приходит картинкой, а не ссылкой на чужой хост', async () => {
    const { deps } = setup();

    const shot = await viewDevice(deps, resident(), 'camera-1');

    assert.match(shot.image, /^data:image\/svg\+xml/);
    assert.deepEqual(shot.at, NOW);
  });

  it('гостевой код живёт минуты и открывает одну дверь', async () => {
    const { hub, deps } = setup();

    const issued = await inviteGuest(deps, resident(), 'intercom-1');

    assert.equal(issued.code, '123456');
    assert.equal(issued.deviceId, 'intercom-1');
    assert.equal(issued.expiresAt.getTime() - NOW.getTime(), 15 * 60_000);
    assert.equal(hub.codes.length, 1);
  });

  it('гостевой код срабатывает один раз, и хозяин узнаёт об этом', async () => {
    const { hub, deps, repository, sent } = setup();

    await repository.saveResident(resident());

    const issued = await inviteGuest(deps, resident(), 'intercom-1');

    await openByCode(deps, issued.code);

    await assert.rejects(openByCode(deps, issued.code), /не действует/);

    const opened = hub.events.filter((event) => event.action === 'opened');

    assert.equal(opened.length, 1);
    assert.deepEqual(opened[0], {
      deviceId: 'intercom-1',
      at: NOW,
      action: 'opened',
      by: 'guest',
      residentId: 'res-1',
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.maxUserId, 1001);
    assert.match(sent[0]?.text ?? '', /Гостевой код сработал: Домофон, подъезд 1/);
  });

  it('выданный код виден хозяину и отзывается', async () => {
    const { deps, repository } = setup();

    await repository.saveResident(resident());

    const issued = await inviteGuest(deps, resident(), 'intercom-1');

    assert.deepEqual(
      (await activeGuestCodes(deps, resident())).map((item) => item.code),
      [issued.code],
    );

    await revokeGuestCode(deps, resident(), issued.code);

    assert.deepEqual(await activeGuestCodes(deps, resident()), []);
    await assert.rejects(openByCode(deps, issued.code), /не действует/);
  });

  it('чужой код отозвать нельзя', async () => {
    const { deps, repository } = setup();

    await repository.saveResident(resident());

    const issued = await inviteGuest(deps, resident(), 'intercom-1');
    const neighbour = resident({ id: 'res-2', maxUserId: 1002, apartmentId: 'apt-2' });

    await repository.saveResident(neighbour);

    await assert.rejects(revokeGuestCode(deps, neighbour, issued.code), /у вас нет/);
  });

  it('просроченный код дверь не открывает', async () => {
    let now = NOW;
    const hub = createMockHub({ devices: DEVICES, now: () => now, createCode: () => '654321' });
    const deps: AppDeps = { ...setup().deps, hub, now: () => now };

    const issued = await inviteGuest(deps, resident(), 'intercom-1');

    now = new Date(issued.expiresAt.getTime() + 1000);

    await assert.rejects(openByCode(deps, issued.code), DomainError);
  });

  it('чужой код не открывает ничего', async () => {
    const { deps } = setup();

    await assert.rejects(openByCode(deps, '000000'), /не подходит/);
  });

  it('журнал открытий видит управляющая компания, а не сосед', async () => {
    const { deps } = setup();

    await openDevice(deps, resident(), 'intercom-1');

    assert.deepEqual(await journalFor(deps, resident()), [], 'кто ходил через подъезд, не дело соседа');

    const staff = await journalFor(deps, resident({ role: 'dispatcher', apartmentId: undefined }));

    assert.deepEqual(
      staff.map((event) => event.deviceId),
      ['intercom-1'],
    );
  });

  it('в журнал дома не попадают чужие двери', async () => {
    const { hub, deps } = setup();

    await hub.open('alien', 'resident');
    await openDevice(deps, resident(), 'barrier-1');

    const staff = await journalFor(deps, resident({ role: 'manager', apartmentId: undefined }));

    assert.deepEqual(
      staff.map((event) => event.deviceId),
      ['barrier-1'],
    );
  });

  it('серия просмотров камеры идёт в журнале одной записью, открытия остаются все', async () => {
    let clock = NOW.getTime();
    const hub = createMockHub({ devices: DEVICES, now: () => new Date(clock), createCode: () => '123456' });
    const { repository } = setup();
    const deps = { hub, repository, now: () => new Date(clock), createId: () => 'id-1', defaultBuildingId: BUILDING_ID };

    for (let shown = 0; shown < 5; shown += 1) {
      await viewDevice(deps, resident(), 'camera-1');
      clock += 10_000;
    }

    await openDevice(deps, resident(), 'intercom-1');
    await openDevice(deps, resident(), 'intercom-1');
    await viewDevice(deps, resident({ id: 'res-2', maxUserId: 1002, apartmentId: 'apt-2' }), 'camera-1');

    clock += VIEW_JOURNAL_MINUTES * 60_000;
    await viewDevice(deps, resident(), 'camera-1');

    const journal = await journalFor(deps, resident({ role: 'manager', apartmentId: undefined }));

    assert.deepEqual(
      journal.map((event) => `${event.action}:${event.residentId}`),
      ['snapshot:res-1', 'opened:res-1', 'opened:res-1', 'snapshot:res-2', 'snapshot:res-1'],
    );
    assert.equal(hub.events.filter((event) => event.action === 'snapshot').length, 7, 'домофония помнит каждый кадр');
  });
});
