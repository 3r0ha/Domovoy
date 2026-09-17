-- Попытки привязки к квартире: по ним ловится перебор кодов из квитанции.

create table if not exists bind_attempt (
  resident_id text not null references resident (id) on delete cascade,
  at          timestamptz not null,
  ok          boolean not null
);

create index if not exists bind_attempt_idx on bind_attempt (resident_id, at desc);
