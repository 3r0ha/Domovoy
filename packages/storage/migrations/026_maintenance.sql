-- Плановое обслуживание оборудования: у лифта и узла учёта свой регламент,
-- за нарушение которого штрафует жилинспекция.

alter type inspection_kind add value if not exists 'lift';
alter type inspection_kind add value if not exists 'intercom';
alter type inspection_kind add value if not exists 'meter_unit';

alter table equipment add column if not exists kind text;
alter table inspection add column if not exists equipment_code text;
