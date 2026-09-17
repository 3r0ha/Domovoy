-- Ответ соседа на вопрос «у вас тоже?» в обе стороны.
alter table request_reporter
  add column if not exists affected boolean not null default true;
