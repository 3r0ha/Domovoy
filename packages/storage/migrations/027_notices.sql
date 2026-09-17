-- Что человек отключил: аварии и свои заявки в этот список не попадают.

alter table resident add column if not exists mutes text[] not null default '{}';
