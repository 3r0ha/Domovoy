-- Плановые работы живут в объявлении, а не отдельной таблицей.
alter table announcement add column works_category text;
alter table announcement add column works_from timestamptz;
alter table announcement add column works_until timestamptz;

-- Либо все три заполнены, либо ни одной.
alter table announcement
  add constraint announcement_works_complete check (
    (works_category is null and works_from is null and works_until is null)
    or (works_category is not null and works_from is not null and works_until is not null)
  );

-- «Идут ли сейчас работы по дому» проверяется на каждом обращении.
create index announcement_works_idx on announcement (building_id, works_until)
  where works_category is not null;
