-- Ключ реплики собирается из времени и автора, поэтому порядок чтения по нему
-- больше не совпадает с порядком переписки. Порядок задаёт номер записи:
-- реплики одной секунды читаются так, как их написали.

alter table support_message add column if not exists seq bigserial;

drop index if exists support_message_ticket_idx;

create index if not exists support_message_order_idx on support_message (ticket_id, at, seq);
