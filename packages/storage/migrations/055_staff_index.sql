-- Смена дома отбирается по роли и дому, а жильцов в таблице на два порядка
-- больше. Индекс частичный: в нём лежат только сотрудники, поэтому его хватает
-- и на вторую половину отбора, дома сверх своего.

create index if not exists resident_staff_idx on resident (building_id, role)
  where role <> 'resident';
