-- Ads: what each ad is about (owner-supplied topic) and the writing angle the worker chose, so the
-- next draft can pick a different angle and the ads read less alike.
alter table public.ads add column if not exists topic text;
alter table public.ads add column if not exists angle text;
