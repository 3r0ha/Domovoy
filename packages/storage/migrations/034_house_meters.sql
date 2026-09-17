-- Общедомовой узел учёта: по нему считается расход на общедомовые нужды.

create table if not exists house_meter (
  id             text primary key,
  building_id    text not null references building (id) on delete cascade,
  kind           meter_kind not null,
  serial         text not null,
  verified_until timestamptz,

  -- Один прибор на ресурс: два дали бы двойной расход дома.
  unique (building_id, kind)
);

create index if not exists house_meter_building_idx on house_meter (building_id);

create table if not exists house_meter_reading (
  id           text primary key,
  meter_id     text not null references house_meter (id) on delete cascade,
  value        numeric(12, 4) not null check (value >= 0),
  at           timestamptz not null,
  submitted_by text not null references resident (id),

  unique (meter_id, at)
);

create index if not exists house_meter_reading_history_idx on house_meter_reading (meter_id, at desc);
