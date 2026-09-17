-- Снимок результата от мастера.
create table request_event_attachment (
  id         bigserial primary key,
  event_id   bigint not null references request_event (id) on delete cascade,
  kind       text not null,
  token      text not null,
  transcript text
);

create index request_event_attachment_event_idx on request_event_attachment (event_id, id);
