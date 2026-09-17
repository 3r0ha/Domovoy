-- Мастер подтвердил присутствие сканом наклейки объекта.
alter table request_event
  add column if not exists on_site boolean not null default false;
