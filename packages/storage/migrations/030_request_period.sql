-- Реестр за месяц и постраничная история ходят по дате, а не по состоянию.

create index if not exists service_request_period_idx on service_request (building_id, created_at desc);
