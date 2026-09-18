-- Собрание собственников отличается от опроса жильцов: у собрания есть сроки,
-- сообщение в системе и протокол, у опроса только мнение.
alter table poll add column if not exists mode text not null default 'meeting';
alter table poll add column if not exists notice_id text;
alter table poll add column if not exists protocol_id text;
