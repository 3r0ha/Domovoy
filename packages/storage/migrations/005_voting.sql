-- Общее собрание собственников.

alter table apartment
  add column if not exists area numeric(8, 2) check (area is null or area > 0);

create type poll_kind as enum ('simple', 'qualified');
create type vote_choice as enum ('for', 'against', 'abstain');

create table if not exists poll (
  id          text primary key,
  building_id text not null references building (id) on delete cascade,
  kind        poll_kind not null,
  title       text not null,
  question    text not null,
  opens_at    timestamptz not null,
  closes_at   timestamptz not null,

  check (closes_at > opens_at)
);

create index if not exists poll_building_idx on poll (building_id, closes_at desc);

create table if not exists poll_vote (
  poll_id      text not null references poll (id) on delete cascade,
  apartment_id text not null references apartment (id) on delete cascade,
  choice       vote_choice not null,
  at           timestamptz not null,
  resident_id  text not null references resident (id),

  -- Одно помещение, один голос.
  primary key (poll_id, apartment_id)
);
