import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DomainError,
  bookVisit,
  cancelVisit,
  checkReception,
  formatReception,
  isActiveVisit,
  momentIn,
  partsIn,
  receptionSlots,
  type ReceptionWindow,
  type Visit,
} from '../dist/index.js';

const ZONE = 'Asia/Yekaterinburg';

/** Вторник и четверг с трёх до семи вечера. */
const WINDOWS: ReceptionWindow[] = [
  { weekday: 2, from: '15:00', to: '19:00' },
  { weekday: 4, from: '15:00', to: '17:00' },
];

/** Понедельник, 21 сентября 2026 года, 10 утра в Екатеринбурге. */
const NOW = momentIn({ year: 2026, month: 9, day: 21, hour: 10, minute: 0 }, ZONE);

describe('часы приёма', () => {
  it('местное время считается в поясе дома', () => {
    const local = partsIn(NOW, ZONE);

    assert.deepEqual(local, { year: 2026, month: 9, day: 21, hour: 10, minute: 0, weekday: 1 });
    assert.equal(partsIn(NOW, 'Europe/Moscow').hour, 8, 'в Москве на два часа раньше');
  });

  it('свободные часы идут по приёмным окнам', () => {
    const slots = receptionSlots({ windows: WINDOWS, from: NOW, days: 7, timeZone: ZONE });

    // Вторник: восемь получасовых приёмов, четверг: четыре.
    assert.equal(slots.length, 12);

    const first = partsIn(slots[0]!, ZONE);

    assert.deepEqual(
      { day: first.day, hour: first.hour, minute: first.minute },
      { day: 22, hour: 15, minute: 0 },
    );

    const last = partsIn(slots.at(-1)!, ZONE);

    assert.deepEqual({ day: last.day, hour: last.hour, minute: last.minute }, { day: 24, hour: 16, minute: 30 });
  });

  it('занятое время в список не попадает', () => {
    const all = receptionSlots({ windows: WINDOWS, from: NOW, days: 7, timeZone: ZONE });
    const free = receptionSlots({ windows: WINDOWS, from: NOW, days: 7, timeZone: ZONE, taken: [all[0]!, all[3]!] });

    assert.equal(free.length, all.length - 2);
    assert.equal(
      free.some((slot) => slot.getTime() === all[0]!.getTime()),
      false,
    );
  });

  it('прошедшее время не предлагается', () => {
    const tuesday = momentIn({ year: 2026, month: 9, day: 22, hour: 16, minute: 0 }, ZONE);
    const slots = receptionSlots({ windows: WINDOWS, from: tuesday, days: 1, timeZone: ZONE });

    assert.deepEqual(
      slots.map((slot) => partsIn(slot, ZONE).hour * 60 + partsIn(slot, ZONE).minute),
      [16 * 60 + 30, 17 * 60, 17 * 60 + 30, 18 * 60, 18 * 60 + 30],
    );
  });

  it('без приёмных окон записи нет', () => {
    assert.deepEqual(receptionSlots({ windows: [], from: NOW, timeZone: ZONE }), []);
  });

  it('окно проверяется при сохранении', () => {
    assert.deepEqual(checkReception([{ weekday: 2, from: ' 15:00 ', to: '19:00' }]), [
      { weekday: 2, from: '15:00', to: '19:00' },
    ]);

    for (const wrong of [
      { weekday: 0, from: '15:00', to: '19:00' },
      { weekday: 2, from: 'утром', to: '19:00' },
      { weekday: 2, from: '19:00', to: '15:00' },
    ]) {
      assert.throws(() => checkReception([wrong]), (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'reception_invalid');
        return true;
      });
    }
  });

  it('окна словами читаются по дням недели', () => {
    assert.equal(formatReception(WINDOWS), 'вторник 15:00-19:00, четверг 15:00-17:00');
  });
});

describe('запись на приём', () => {
  const slots = receptionSlots({ windows: WINDOWS, from: NOW, days: 7, timeZone: ZONE });

  const visit = (): Visit =>
    bookVisit({
      id: 'vis-1',
      buildingId: 'dom15',
      residentId: 'res-1',
      at: slots[0]!,
      topic: 'Перерасчёт за горячую воду',
      now: NOW,
      slots,
    });

  it('запись встаёт на свободное время', () => {
    const booked = visit();

    assert.equal(booked.status, 'booked');
    assert.equal(booked.minutes, 30);
    assert.equal(booked.topic, 'Перерасчёт за горячую воду');
    assert.equal(isActiveVisit(booked, NOW), true);
  });

  it('на занятое время записаться нельзя', () => {
    const free = slots.slice(1);

    assert.throws(
      () =>
        bookVisit({
          id: 'vis-2',
          buildingId: 'dom15',
          residentId: 'res-2',
          at: slots[0]!,
          topic: 'Тот же час',
          now: NOW,
          slots: free,
        }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'slot_taken');
        return true;
      },
    );
  });

  it('тема обязательна', () => {
    assert.throws(
      () =>
        bookVisit({
          id: 'vis-3',
          buildingId: 'dom15',
          residentId: 'res-1',
          at: slots[0]!,
          topic: '   ',
          now: NOW,
          slots,
        }),
      /Напишите, с чем придёте/,
    );
  });

  it('запись отменяется до начала приёма', () => {
    const cancelled = cancelVisit(visit(), NOW);

    assert.equal(cancelled.status, 'cancelled');
    assert.equal(isActiveVisit(cancelled, NOW), false);

    assert.throws(() => cancelVisit(cancelled, NOW), /уже закрыта/);
    assert.throws(() => cancelVisit(visit(), new Date(slots[0]!.getTime() + 60_000)), /Приём уже начался/);
  });

  it('прошедший приём перестаёт быть действующим', () => {
    const booked = visit();
    const after = new Date(booked.at.getTime() + 31 * 60_000);

    assert.equal(isActiveVisit(booked, after), false);
  });
});
