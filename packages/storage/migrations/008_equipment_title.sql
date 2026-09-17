-- Название оборудования хранится в заявке: адрес в ней читает человек.
alter table service_request add column equipment_title text;

-- Заявкам, заведённым до этой миграции, название проставляем из справочника.
update service_request
   set equipment_title = equipment.title
  from equipment
 where service_request.equipment_code = equipment.code
   and service_request.building_id = equipment.building_id
   and service_request.equipment_title is null;
