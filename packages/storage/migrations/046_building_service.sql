-- Сведения об обслуживании дома: телефоны, режим работы и адрес приёма.
alter table building add column if not exists emergency_phone text;
alter table building add column if not exists company_phone text;
alter table building add column if not exists company_email text;
alter table building add column if not exists work_hours text;
alter table building add column if not exists office_address text;
alter table building add column if not exists office_hours text;
