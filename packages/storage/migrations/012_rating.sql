-- Оценка работы жильцом.
alter table service_request
  add column if not exists rating smallint,
  add constraint service_request_rating_range check (rating is null or rating between 1 and 5);
