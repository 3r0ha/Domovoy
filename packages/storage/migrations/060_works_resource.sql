-- Ресурс отключения: по нему квитанция считает перерасчёт за перерыв дольше нормы.
alter table announcement add column works_resource text;
