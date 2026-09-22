-- Осмотры общего имущества: обязанность управляющей организации по минимальному перечню работ.
create type inspection_kind as enum ('entrance', 'roof', 'basement', 'ventilation');

create table inspection (
  id          text primary key,
  building_id text not null references building (id) on delete cascade,
  kind        inspection_kind not null,
  -- Пусто у осмотров, которые идут по дому целиком: кровля одна на дом.
  entrance    integer,
  due_at      timestamptz not null,
  created_at  timestamptz not null,
  assignee_id text references resident (id) on delete set null,
  finished_at timestamptz
);

create index inspection_building_idx on inspection (building_id, kind, entrance);

create table inspection_item (
  inspection_id text not null references inspection (id) on delete cascade,
  -- Порядок обхода: им же пункт и адресуется.
  position      integer not null,
  title         text not null,
  state         text,
  comment       text,
  checked_at    timestamptz,

  primary key (inspection_id, position)
);

-- Найденный недостаток становится заявкой: связь нужна, чтобы по отчёту
-- об осмотре было видно, что с ним сделали.
create table inspection_request (
  inspection_id text not null references inspection (id) on delete cascade,
  request_id    text not null references service_request (id) on delete cascade,

  primary key (inspection_id, request_id)
);

create table inspection_item_attachment (
  inspection_id text not null references inspection (id) on delete cascade,
  position      integer not null,
  kind          text not null check (kind in ('photo', 'voice', 'file')),
  token         text not null,
  transcript    text,

  primary key (inspection_id, position, token)
);
