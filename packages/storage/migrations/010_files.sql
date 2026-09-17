-- Снимки из мини-приложения.
create table attachment_file (
  id           text primary key,
  content_type text not null,
  bytes        bytea not null,
  -- Кто прислал и к какому дому относится: по ним решается, кто вправе смотреть.
  uploaded_by  text not null references resident (id) on delete cascade,
  building_id  text not null references building (id) on delete cascade,
  created_at   timestamptz not null
);

-- Файлы без заявки, мусор: жилец выбрал снимок и закрыл приложение, не отправив обращение.
create index attachment_file_created_at_idx on attachment_file (created_at);
