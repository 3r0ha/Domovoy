-- Запись на приём в управляющую организацию и приёмные окна дома.
alter table building add column if not exists reception text;
alter table building add column if not exists visit_minutes integer;

create table if not exists visit (
  id text primary key,
  building_id text not null references building (id) on delete cascade,
  resident_id text not null references resident (id) on delete cascade,
  at timestamptz not null,
  minutes integer not null,
  topic text not null,
  status text not null,
  created_at timestamptz not null
);

create index if not exists visit_building_at on visit (building_id, at);
create index if not exists visit_resident_at on visit (resident_id, at);

-- Одно и то же время дважды не занимается: отменённые записи не мешают.
create unique index if not exists visit_slot_taken on visit (building_id, at) where status = 'booked';
