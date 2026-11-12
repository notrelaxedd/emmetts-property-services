-- =============================================================================
-- 20261112000100 — Who on the team talks to each customer.
--   customers.communicator_id  the team member (an owner or crew profile) who handles this customer's
--                              calls and texts. Null = nobody yet. Set on the customer's page; "Add a
--                              customer" and the first logged conversation fill it with whoever did it.
-- Goes null if that profile is deleted. A soft-removed member (profiles.removed_at) keeps their
-- customers until someone reassigns them. Owner-only like the rest of customers (RLS in 0500).
-- =============================================================================

alter table public.customers
  add column communicator_id uuid references public.profiles (id) on delete set null;

create index customers_communicator_idx on public.customers (communicator_id) where communicator_id is not null;

comment on column public.customers.communicator_id is
  'Team member (profiles.id) who communicates with this customer. Null = not assigned.';
