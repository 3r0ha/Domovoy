-- Ответственный по дому: к нему обращаются с тем, чего не решают бот и приложение.
alter table building add column if not exists contact_name text;
alter table building add column if not exists contact_role text;
alter table building add column if not exists contact_phone text;
alter table building add column if not exists contact_email text;
