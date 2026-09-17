-- Передача обращения смежной организации: ресурсникам, подрядчику,
-- муниципальной службе или надзору, с ожидаемым сроком ответа.
alter table building add column if not exists partners jsonb;

create table if not exists handoff (
  id text primary key,
  request_id text not null references service_request (id) on delete cascade,
  building_id text not null references building (id) on delete cascade,
  target text not null,
  organization text not null,
  channel text not null,
  external_id text,
  status text not null,
  due_at timestamptz not null,
  answer text,
  created_at timestamptz not null,
  answered_at timestamptz
);

create index if not exists handoff_request on handoff (request_id, created_at);
create index if not exists handoff_waiting on handoff (building_id, status, due_at);
