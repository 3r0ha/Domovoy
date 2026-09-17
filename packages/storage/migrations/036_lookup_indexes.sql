-- «Мои заявки» ищут по отвечавшему, «мои наряды», по исполнителю.

create index if not exists request_reporter_resident_idx on request_reporter (resident_id, request_id);

create index if not exists service_request_assignee_idx on service_request (assignee_id)
  where assignee_id is not null;
