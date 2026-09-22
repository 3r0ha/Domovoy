-- Согласование визита в квартиру, материалы наряда и несогласие с отказом.
alter table service_request add column if not exists appointment jsonb;
alter table service_request add column if not exists materials jsonb;
alter table service_request add column if not exists disputed_at timestamptz;

-- Право собственности на помещение: голосуют собственники, а не проживающие.
alter table resident add column if not exists owned jsonb;

alter table poll_vote add column if not exists share numeric(6, 5);
alter table initiative_signature add column if not exists share numeric(6, 5);

-- Сособственники голосуют каждый своей долей, поэтому голос принадлежит
-- человеку, а не помещению: ключ расширяется, и сосед чужой голос не перебьёт.
alter table poll_vote drop constraint if exists poll_vote_pkey;
alter table poll_vote add primary key (poll_id, apartment_id, resident_id);

alter table initiative_signature drop constraint if exists initiative_signature_pkey;
alter table initiative_signature add primary key (initiative_id, resident_id);

-- Тихие часы: объявление, опубликованное ночью, ждёт утра.
alter table announcement add column if not exists deliver_at timestamptz;

create index if not exists announcement_deliver_idx on announcement (deliver_at)
  where deliver_at is not null;

-- Дом, которого в продукте ещё нет: просьба подключить его.
create table if not exists connection_request (
  id          text primary key,
  resident_id text not null,
  address     text not null,
  company     text,
  phone       text,
  at          timestamptz not null
);

create unique index if not exists connection_request_resident_idx on connection_request (resident_id);
create index if not exists connection_request_at_idx on connection_request (at desc);
