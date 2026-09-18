-- Заявки всегда отдаются свежими вперёд, поэтому время создания входит в ключ.
-- Прежние индексы становятся префиксами новых и удаляются.

drop index if exists service_request_queue_idx;
drop index if exists service_request_author_idx;
drop index if exists service_request_assignee_idx;

create index if not exists service_request_queue_recent
  on service_request (building_id, status, created_at desc);

create index if not exists service_request_author_recent
  on service_request (author_id, created_at desc);

create index if not exists service_request_assignee_recent
  on service_request (assignee_id, created_at desc)
  where assignee_id is not null;
