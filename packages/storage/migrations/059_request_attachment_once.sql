-- Вложение заявки узнаётся по файлу, а не по своему месту в списке:
-- повтор сохранения после таймаута перестаёт удваивать вложения.

delete from request_attachment doubled
using request_attachment kept
where kept.request_id = doubled.request_id
  and kept.token = doubled.token
  and kept.id < doubled.id;

create unique index if not exists request_attachment_once
  on request_attachment (request_id, token);
