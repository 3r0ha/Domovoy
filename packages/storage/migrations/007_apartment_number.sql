-- Номер квартиры хранится в самой заявке: заявка, документ.
alter table service_request add column apartment_number integer;

-- Заявкам до этой миграции номер проставляем из справочника.
update service_request
   set apartment_number = apartment.number
  from apartment
 where service_request.apartment_id = apartment.id
   and service_request.apartment_number is null;
