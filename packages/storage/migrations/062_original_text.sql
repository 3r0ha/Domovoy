-- Что человек написал своими словами, когда продукт перевёл это на русский.
-- Пусто: текст пришёл по-русски и переводить его было нечего.
alter table service_request add column original_text text;
alter table service_request add column original_language text;

alter table request_event add column original_text text;
alter table request_event add column original_language text;

alter table support_message add column original_text text;
alter table support_message add column original_language text;
