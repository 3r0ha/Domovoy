-- Приёмка жильцом, склейка обращений и вложения.

-- «Выполнено» перестаёт быть концом жизни заявки: дальше её принимает жилец.
alter type request_status add value if not exists 'confirmed' after 'done';

alter table service_request
  add column if not exists reopen_count integer not null default 0;

-- Соседи, сообщившие о той же проблеме. Одна авария, одна заявка и N подтверждений.
create table if not exists request_reporter (
  request_id  text not null references service_request (id) on delete cascade,
  resident_id text not null references resident (id) on delete cascade,
  at          timestamptz not null default now(),

  primary key (request_id, resident_id)
);

create index if not exists request_reporter_request_idx on request_reporter (request_id);

-- Вложения хранятся ссылкой на файл платформы: перекладывать байты к себе незачем.
create table if not exists request_attachment (
  id         bigserial primary key,
  request_id text not null references service_request (id) on delete cascade,
  kind       text not null check (kind in ('photo', 'voice', 'file')),
  token      text not null,
  -- Расшифровка голосового: без неё заявка приходит без описания.
  transcript text,
  at         timestamptz not null default now()
);

create index if not exists request_attachment_request_idx on request_attachment (request_id);
