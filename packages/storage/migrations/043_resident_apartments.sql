-- Несколько квартир у одного человека: в этом доме и в других.
alter table resident add column if not exists apartment_ids text[] not null default '{}';

update resident
   set apartment_ids = array[apartment_id]
 where apartment_id is not null
   and apartment_ids = '{}';

create index if not exists resident_apartments on resident using gin (apartment_ids);
