-- Приборы учёта и показания.

create type meter_kind as enum ('cold_water', 'hot_water', 'electricity', 'heating', 'gas');

create table if not exists meter (
  id             text primary key,
  apartment_id   text not null references apartment (id) on delete cascade,
  kind           meter_kind not null,
  -- Заводской номер: по нему сверяют прибор при поверке.
  serial         text not null,
  -- После этой даты показания недостоверны и нужна поверка.
  verified_until timestamptz,

  unique (apartment_id, serial)
);

create index if not exists meter_apartment_idx on meter (apartment_id);

create table if not exists meter_reading (
  id           text primary key,
  meter_id     text not null references meter (id) on delete cascade,
  value        numeric(12, 4) not null check (value >= 0),
  at           timestamptz not null,
  submitted_by text not null references resident (id),

  -- За месяц показание одно: правило продублировано в базе.
  unique (meter_id, at)
);

create index if not exists meter_reading_history_idx on meter_reading (meter_id, at desc);
