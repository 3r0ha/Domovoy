-- Согласие с документами: редакция и момент, когда человек её принял.
alter table resident add column if not exists legal_version text;
alter table resident add column if not exists legal_at timestamptz;
