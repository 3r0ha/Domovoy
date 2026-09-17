-- Домовой постучал к соседу сверху: спрашивают его один раз.
alter table service_request
  add column if not exists knocked_at timestamptz;
