-- Индексы, которые повторяют существующие ключи или стоят на колонках, не
-- участвующих ни в отборе, ни в сортировке. Запись они удорожают, чтение нет.

-- Точные префиксы первичных ключей и ограничений уникальности.
drop index if exists request_reporter_request_idx;
drop index if exists meter_apartment_idx;
drop index if exists house_meter_building_idx;
-- Порядок по убыванию btree даёт обратным проходом по (meter_id, at).
drop index if exists meter_reading_history_idx;
drop index if exists house_meter_reading_history_idx;

-- Колонки, по которым запросов нет.
drop index if exists handoff_by_resident;
drop index if exists resident_on_duty_idx;
drop index if exists attachment_file_created_at_idx;
drop index if exists service_request_deadline_idx;
