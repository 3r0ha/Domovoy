-- Схема данных продукта.

create type role as enum ('resident', 'dispatcher', 'technician', 'manager');
create type request_status as enum ('new', 'accepted', 'in_progress', 'needs_info', 'done', 'rejected');
create type request_category as enum ('plumbing', 'heating', 'electricity', 'elevator', 'cleaning', 'yard', 'other');
create type priority as enum ('emergency', 'normal', 'planned');
create type audience_kind as enum ('building', 'entrance', 'riser');

create table building (
  id         text primary key,
  -- Короткий код для номера заявки, например «Д15».
  code       text not null unique,
  address    text not null,
  created_at timestamptz not null default now()
);

create table apartment (
  id          text primary key,
  building_id text not null references building (id) on delete cascade,
  number      integer not null,
  -- Подъезд и стояк нужны для адресных уведомлений.
  entrance    integer not null,
  riser       integer not null,

  unique (building_id, number)
);

create index apartment_address_idx on apartment (building_id, entrance, riser);

-- Оборудование с наклейкой: лифт, домофон, узел учёта.
create table equipment (
  id          text primary key,
  building_id text not null references building (id) on delete cascade,
  code        text not null,
  title       text not null,

  unique (building_id, code)
);

create table resident (
  id           text primary key,
  -- Идентификатор пользователя MAX: приходит из проверенных параметров запуска.
  max_user_id  bigint not null unique,
  display_name text not null,
  phone        text,
  role         role not null default 'resident',
  building_id  text references building (id) on delete set null,
  apartment_id text references apartment (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index resident_apartment_idx on resident (apartment_id);

create table service_request (
  id          text primary key,
  -- Номер для человека: «Д15-2609-0042».
  number      text not null unique,
  building_id text not null references building (id) on delete cascade,
  author_id   text not null references resident (id),
  assignee_id text references resident (id),
  category    request_category not null,
  priority    priority not null,
  status      request_status not null default 'new',
  description text not null,

  -- Объект заявки: заполняется одно из полей, по нему и определяется адрес.
  target_kind  text not null,
  apartment_id text references apartment (id) on delete set null,
  entrance     integer,
  riser        integer,
  equipment_code text,

  created_at        timestamptz not null,
  reaction_due_at   timestamptz not null,
  resolution_due_at timestamptz not null
);

create index service_request_queue_idx on service_request (building_id, status);
create index service_request_author_idx on service_request (author_id);
-- Очередь диспетчера читается по сроку: индекс закрывает и сортировку.
create index service_request_deadline_idx on service_request (status, resolution_due_at);

-- Событие истории: кто и когда перевёл заявку в новое состояние.
create table request_event (
  id         bigserial primary key,
  request_id text not null references service_request (id) on delete cascade,
  actor_id   text not null references resident (id),
  status     request_status not null,
  role       role not null,
  comment    text,
  at         timestamptz not null
);

create index request_event_order_idx on request_event (request_id, at, id);

create table announcement (
  id           text primary key,
  building_id  text not null references building (id) on delete cascade,
  kind         audience_kind not null,
  entrance     integer,
  riser        integer,
  title        text not null,
  body         text not null,
  created_at   timestamptz not null,
  active_until timestamptz
);

create index announcement_feed_idx on announcement (building_id, created_at desc);

-- Кому адресовано: показывает охват и позволяет отметить прочтение.
create table announcement_recipient (
  announcement_id text not null references announcement (id) on delete cascade,
  apartment_id    text not null references apartment (id) on delete cascade,
  read_at         timestamptz,

  primary key (announcement_id, apartment_id)
);
