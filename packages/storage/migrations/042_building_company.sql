-- Владелец дома: одна установка обслуживает несколько управляющих организаций,
-- и сотрудник одной не видит дома другой. Пусто, весь парк принадлежит одной.
alter table building add column if not exists company_id text;

-- Код дома уникален внутри организации: «Д1» есть у каждой второй компании.
alter table building drop constraint if exists building_code_key;
create unique index if not exists building_code_per_company on building (coalesce(company_id, ''), code);
