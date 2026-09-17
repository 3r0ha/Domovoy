-- Короткая суть заявки.
alter table service_request
  add column if not exists title text;

update service_request
set title = trim(
  case
    when position('.' in left(description, 60)) > 0
      then left(description, position('.' in left(description, 60)) - 1)
    when length(description) <= 60 then description
    else left(description, 60)
  end
)
where title is null;

alter table service_request
  alter column title set not null;
