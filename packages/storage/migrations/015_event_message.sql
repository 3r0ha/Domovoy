-- Переписка по заявке отдельно от смены состояния.
alter table request_event
  add column if not exists is_message boolean not null default false;
