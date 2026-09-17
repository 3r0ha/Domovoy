-- Мастер отсканировал наклейку объекта: обход действительно был на месте.
alter table inspection
  add column if not exists on_site boolean not null default false;
