-- Право на удаление профиля: связь с аккаунтом MAX снимается, а заявки дома
-- остаются обезличенными, историю ремонта общего имущества стирать нельзя.

alter table resident
  alter column max_user_id drop not null,
  add column if not exists forgotten_at timestamptz;
