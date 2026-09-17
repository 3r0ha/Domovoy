-- Кому поручили работу этим переходом.
alter table request_event
  add column if not exists assignee_id text references resident (id);
