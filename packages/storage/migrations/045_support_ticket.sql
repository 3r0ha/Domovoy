-- Вопрос жильца управляющей организации и переписка по нему.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type ticket_status as enum ('open', 'answered', 'closed');
  end if;
end $$;

create table if not exists support_ticket (
  id          text primary key,
  building_id text not null references building (id) on delete cascade,
  resident_id text not null references resident (id),
  subject     text not null,
  status      ticket_status not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null
);

create index if not exists support_ticket_building_idx on support_ticket (building_id, updated_at desc);
create index if not exists support_ticket_resident_idx on support_ticket (resident_id, updated_at desc);

create table if not exists support_message (
  id          text primary key,
  ticket_id   text not null references support_ticket (id) on delete cascade,
  at          timestamptz not null,
  author_side text not null,
  author_id   text not null references resident (id),
  author_name text,
  text        text not null
);

create index if not exists support_message_ticket_idx on support_message (ticket_id, at);

create table if not exists support_attachment (
  message_id text not null references support_message (id) on delete cascade,
  position   integer not null,
  kind       text not null,
  token      text not null,
  transcript text,

  primary key (message_id, position)
);
