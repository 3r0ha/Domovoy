create table if not exists initiative (
  id          text primary key,
  building_id text not null references building (id) on delete cascade,
  author_id   text not null references resident (id),
  kind        poll_kind not null,
  title       text not null,
  question    text not null,
  created_at  timestamptz not null,
  poll_id     text references poll (id) on delete set null
);

create index if not exists initiative_building_idx on initiative (building_id, created_at desc);

create table if not exists initiative_signature (
  initiative_id text not null references initiative (id) on delete cascade,
  apartment_id  text not null references apartment (id) on delete cascade,
  resident_id   text not null references resident (id),
  at            timestamptz not null,

  -- Подпись весит площадью помещения, поэтому она одна на помещение.
  primary key (initiative_id, apartment_id)
);
