-- Имя, заданное самим человеком: имя из платформы его больше не перебивает.
alter table resident add column if not exists name_by_user boolean;
