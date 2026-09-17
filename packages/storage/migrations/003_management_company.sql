-- Управляющая организация дома.
alter table building
  add column if not exists management_company text;
