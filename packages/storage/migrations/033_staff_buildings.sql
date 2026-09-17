-- Дома, которые обслуживает сотрудник кроме своего: заявка из соседнего
-- адреса иначе никого не будит.

alter table resident add column if not exists serves_building_ids text[] not null default '{}';
