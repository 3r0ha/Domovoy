-- Дежурство: вне рабочих часов уведомления уходят только тем, у кого стоит этот признак.
alter table resident add column on_duty boolean not null default false;

-- Индекс частичный: сотрудников в доме единицы, а жильцов сотни.
create index resident_on_duty_idx on resident (building_id) where on_duty;
