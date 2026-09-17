-- Объявление, которое продукт написал сам по подтверждённой аварии.

alter table announcement add column if not exists request_id text references service_request (id) on delete set null;
