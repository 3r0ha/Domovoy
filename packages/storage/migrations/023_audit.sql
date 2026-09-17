-- Журнал действий сотрудников: кто открыл дверь, снял дежурство, удалил показание.

create table if not exists audit_entry (
  id          text primary key,
  at          timestamptz not null,
  -- Имя рядом с идентификатором: профиль сотрудника могут обезличить, а журнал должен остаться читаемым.
  actor_id    text not null references resident (id),
  actor_name  text not null,
  action      text not null,
  building_id text not null references building (id) on delete cascade,
  subject     text,
  details     text
);

create index if not exists audit_building_idx on audit_entry (building_id, at desc);
