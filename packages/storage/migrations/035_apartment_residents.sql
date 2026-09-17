-- Сколько человек проживает: по этому числу считается норматив, когда
-- показаний нет. Без него норматив пришлось бы считать за одного.

alter table apartment add column if not exists residents integer check (residents >= 0);
