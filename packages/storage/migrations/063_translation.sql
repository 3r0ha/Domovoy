-- Машинный перевод текста на один язык. Пустой text означает, что служба
-- не перевела: такая запись живёт недолго и нужна, чтобы не спрашивать снова.
create table if not exists translation (
  fingerprint text not null,
  language    text not null,
  text        text,
  at          timestamptz not null,

  primary key (fingerprint, language)
);

create index if not exists translation_at_idx on translation (at);
