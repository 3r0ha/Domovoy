-- Итоги собрания: без даты подведения протокола нет, а собрание без протокола ничего не решило.

alter table poll
  add column if not exists started_by text references resident (id),
  add column if not exists closed_at  timestamptz;
