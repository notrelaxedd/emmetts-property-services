-- =============================================================================
-- 0100 — Enum types
-- Names and labels mirror the `Enums` block of lib/db/types.ts exactly.
-- =============================================================================

create type public.role              as enum ('owner', 'crew');
create type public.lead_status       as enum ('new', 'quoting', 'quoted', 'won', 'lost', 'spam');
create type public.quote_status      as enum ('draft', 'needs_owner', 'sent', 'accepted', 'expired', 'declined');
create type public.quote_item_status as enum ('auto', 'needs_owner', 'priced', 'referred', 'declined');
create type public.job_status        as enum ('unscheduled', 'proposed', 'crew_confirmed', 'booked', 'in_progress', 'done', 'cancelled');
create type public.assignment_status as enum ('offered', 'accepted', 'declined', 'swap_offered', 'drop_requested', 'dropped');
create type public.exception_kind    as enum ('off', 'extra');
create type public.exception_status  as enum ('pending', 'approved', 'declined');
create type public.approval_kind     as enum ('ad', 'quote', 'custom_item', 'booking', 'followup', 'crew_change', 'drop', 'weather_hold', 'ai_cap');
create type public.approval_status   as enum ('pending', 'approved', 'edited', 'rejected');
create type public.ad_channel        as enum ('facebook', 'instagram', 'nextdoor');
create type public.ad_status         as enum ('draft', 'approved', 'posted');
create type public.message_channel   as enum ('email', 'sms');
create type public.message_kind      as enum ('quote', 'confirmation', 'reminder', 'review', 'snow', 'referral', 'decline', 'custom');
create type public.message_status    as enum ('draft', 'queued', 'sent', 'failed', 'cancelled');
create type public.fleet_role        as enum ('ads', 'quotes', 'scheduler', 'followup', 'host');
create type public.fleet_task_type   as enum ('quote', 'schedule', 'ad_draft', 'followup_review', 'followup_reminder', 'weather_watch', 'send_message', 'custom_summary');
create type public.fleet_task_status as enum ('queued', 'running', 'done', 'failed');
