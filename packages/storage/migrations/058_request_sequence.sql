-- Номер заявки выдаёт счётчик, а не пересчёт строк: две заявки одного дома,
-- поданные одновременно, получали один номер и вторая падала на unique.

create table if not exists request_sequence (
  building_id text not null references building (id) on delete cascade,
  -- Месяц в поясе дома, «2026-09».
  period      text not null,
  last_number integer not null,

  primary key (building_id, period)
);

-- Счётчик поднимается с уже записанных заявок: нумерация не начинается заново.
insert into request_sequence (building_id, period, last_number)
select request.building_id,
       to_char(request.created_at at time zone coalesce(building.time_zone, 'UTC'), 'YYYY-MM'),
       count(*)
from service_request request
join building on building.id = request.building_id
group by 1, 2
on conflict (building_id, period) do nothing;
