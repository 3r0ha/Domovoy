-- Жалобу в надзор отправляет жилец, а не смена: обращение хранится там же,
-- где передачи, но отличается отправителем.
alter table handoff add column if not exists by_resident boolean not null default false;

create index if not exists handoff_by_resident on handoff (request_id, by_resident);
