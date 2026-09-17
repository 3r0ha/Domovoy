-- Код квартиры из квитанции: им жилец подтверждает, что квартира его.
alter table apartment add column if not exists code text;

-- Заведённым раньше квартирам код выдаётся здесь: идентификатор подбирается,
-- а код нет. Знаки те же, что и у выдачи в продукте.
update apartment
set code = (
  select string_agg(
    substr(
      'ACEFHKLMNPRTUVWXY34789',
      1 + (get_byte(digest_bytes, position) % 22),
      1
    ),
    ''
  )
  from (
    select decode(md5(random()::text || apartment.id), 'hex') as digest_bytes,
           generate_series(0, 7) as position
  ) as source
)
where code is null;

create unique index if not exists apartment_code_unique on apartment (code);
