-- Чат дома в MAX: одно объявление вместо переписки с каждым.

alter table building add column if not exists chat_id bigint;
