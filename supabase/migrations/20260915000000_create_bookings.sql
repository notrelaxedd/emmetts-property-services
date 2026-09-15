-- Booking requests from the website form.
-- Run this in the Supabase SQL editor (or `supabase db push`) before going live.

create table if not exists public.bookings (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  name           text not null check (char_length(name) between 2 and 100),
  email          text not null check (char_length(email) between 3 and 254),
  phone          text not null check (char_length(phone) between 7 and 30),
  address        text not null check (char_length(address) between 5 and 200),
  service        text not null check (char_length(service) between 1 and 64),
  preferred_date date not null,
  notes          text check (notes is null or char_length(notes) <= 1000),
  -- For the crew's own tracking in the Supabase table editor.
  status         text not null default 'new'
                 check (status in ('new', 'contacted', 'scheduled', 'done', 'cancelled'))
);

comment on table public.bookings is 'Service booking requests submitted from the website.';

create index if not exists bookings_created_at_idx on public.bookings (created_at desc);
create index if not exists bookings_status_idx on public.bookings (status);

-- Lock the table down. The website inserts through a server action using the service-role key,
-- which bypasses RLS. With RLS on and no policies, the public anon key can't read or write anything.
alter table public.bookings enable row level security;
