alter table poll
  add column if not exists elder_entrance integer,
  add column if not exists elder_resident_id text references resident (id);

create table if not exists eldership (
  building_id text not null references building (id) on delete cascade,
  entrance    integer not null,
  resident_id text not null references resident (id),
  since       timestamptz not null,
  until       timestamptz not null,

  -- Старший у подъезда один: новые полномочия сменяют прежние.
  primary key (building_id, entrance),
  check (until > since)
);
