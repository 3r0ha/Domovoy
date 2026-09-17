-- Тарифы дома.

create table if not exists tariff (
  building_id text not null references building (id) on delete cascade,
  kind        text not null,
  value       numeric(10, 4) not null check (value >= 0),
  since       timestamptz not null,

  primary key (building_id, kind, since)
);
