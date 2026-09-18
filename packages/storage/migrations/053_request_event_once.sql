-- История заявки дописывается по содержанию события, а не по их количеству:
-- два одновременных сохранения перестают затирать друг друга.
-- Ключ шире пары «время и автор»: смена успевает сделать несколько переходов
-- в одну миллисекунду, и они остаются разными событиями.

delete from request_event doubled
using request_event kept
where kept.request_id = doubled.request_id
  and kept.at = doubled.at
  and kept.actor_id = doubled.actor_id
  and kept.status = doubled.status
  and kept.is_message = doubled.is_message
  and coalesce(kept.comment, '') = coalesce(doubled.comment, '')
  and kept.id < doubled.id;

create unique index if not exists request_event_once
  on request_event (request_id, at, actor_id, status, is_message, md5(coalesce(comment, '')));
