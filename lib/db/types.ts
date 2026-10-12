/**
 * Database contract. The SQL in `supabase/migrations/` MUST match these shapes exactly, and every
 * piece of app, worker and test code imports its row types from here. If you change a column,
 * change it here and in a new migration in the same commit.
 *
 * Conventions: every table has `id uuid pk`, `created_at timestamptz`, `updated_at timestamptz`
 * (auto-bumped by trigger). Money is `numeric` in Postgres and arrives as a `number` through
 * supabase-js (we cast in SQL views / selects where precision matters). Times are ISO strings.
 */

// ---------- Enums (Postgres enum types with the same names) ----------

export type Role = "owner" | "crew";
export type LeadStatus = "new" | "quoting" | "quoted" | "won" | "lost" | "spam";
export type QuoteStatus = "draft" | "needs_owner" | "sent" | "accepted" | "expired" | "declined";
export type QuoteItemStatus = "auto" | "needs_owner" | "priced" | "referred" | "declined";
export type JobStatus =
  | "unscheduled"
  | "proposed"
  | "crew_confirmed"
  | "booked"
  | "in_progress"
  | "done"
  | "cancelled";
export type AssignmentStatus =
  | "offered"
  | "accepted"
  | "declined"
  | "swap_offered"
  | "drop_requested"
  | "dropped";
export type ExceptionKind = "off" | "extra";
export type ExceptionStatus = "pending" | "approved" | "declined";
export type ApprovalKind =
  | "ad"
  | "quote"
  | "custom_item"
  | "booking"
  | "followup"
  | "crew_change"
  | "drop"
  | "weather_hold"
  | "ai_cap";
export type ApprovalStatus = "pending" | "approved" | "edited" | "rejected";
export type AdChannel = "facebook" | "instagram" | "nextdoor";
export type AdStatus = "draft" | "approved" | "posted";
export type MessageChannel = "email" | "sms";
export type MessageKind =
  | "quote"
  | "confirmation"
  | "reminder"
  | "review"
  | "snow"
  | "referral"
  | "decline"
  | "custom";
export type MessageStatus = "draft" | "queued" | "sent" | "failed" | "cancelled";
export type FleetRole = "ads" | "quotes" | "scheduler" | "followup" | "host";
export type FleetTaskType =
  | "quote"
  | "schedule"
  | "ad_draft"
  | "followup_review"
  | "followup_reminder"
  | "weather_watch"
  | "send_message"
  | "custom_summary";
export type FleetTaskStatus = "queued" | "running" | "done" | "failed";
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, matches JS Date#getDay()

// ---------- JSON column shapes ----------

/** `services.minutes_rule` — how long a service takes. All numbers are minutes. */
export type MinutesRule = {
  /** Minutes for any lot, before per-acre scaling. */
  base: number;
  /** Extra minutes per acre of lot. */
  per_acre: number;
  /** Multipliers by tree cover level (1.0 = none). */
  tree_cover: { none: number; light: number; medium: number; heavy: number };
};
export type TreeCover = keyof MinutesRule["tree_cover"];

/** `settings.autopilot` — per approval kind. All false by default. */
export type AutopilotRules = {
  ad: { enabled: boolean };
  /** Auto-send quotes whose total is at or under `max_total`. */
  quote: { enabled: boolean; max_total: number | null };
  custom_item: { enabled: boolean };
  booking: { enabled: boolean };
  followup: { enabled: boolean };
  crew_change: { enabled: boolean };
  drop: { enabled: boolean };
  weather_hold: { enabled: boolean };
};

/** `ads.targeting` */
export type AdTargeting = {
  radius_miles?: number;
  center?: { lat: number; lng: number };
  cities?: string[];
  age_min?: number;
  age_max?: number;
  interests?: string[];
};

/** `leads.utm` */
export type Utm = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
};

/** `fleet_tasks.payload` by `type` (loosely typed; workers validate with zod). */
export type FleetTaskPayload = Record<string, unknown>;

// ---------- Rows ----------

type Base = { id: string; created_at: string; updated_at: string };

export type Profile = Base & {
  user_id: string;
  role: Role;
  name: string;
  email: string | null;
  phone: string | null;
  max_hours_week: number;
  paused: boolean;
  hourly_rate: number;
  /** Home base for drive-time estimates. */
  lat: number | null;
  lng: number | null;
};

export type Service = Base & {
  /** Stable key; matches `lib/services.ts` slugs where the site has a card for it. */
  slug: string;
  name: string;
  active: boolean;
  auto_quote: boolean;
  default_crew_size: number;
  minutes_rule: MinutesRule;
  seasonal: "spring-summer" | "fall" | "winter" | "all";
  sort_order: number;
};

export type Customer = Base & {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  parcel_id: string | null;
  lot_acres: number | null;
  tree_cover: TreeCover | null;
  email_opt_in: boolean;
  sms_opt_in: boolean;
  snow_list: boolean;
  notes: string | null;
  /** Token used in unsubscribe links. */
  unsubscribe_token: string;
};

export type Lead = Base & {
  customer_id: string;
  source: string;
  utm: Utm;
  requested_service_ids: string[];
  custom_request: string | null;
  /** Storage object paths inside the private `lead-photos` bucket. */
  photo_paths: string[];
  preferred_days: Weekday[];
  status: LeadStatus;
};

export type Quote = Base & {
  lead_id: string;
  customer_id: string;
  status: QuoteStatus;
  price_total: number;
  labor_total: number;
  fee_total: number;
  profit_total: number;
  margin: number;
  wage: number;
  stripe_checkout_id: string | null;
  stripe_checkout_url: string | null;
  stripe_payment_intent_id: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  expires_at: string | null;
  /** Short "why" from the quotes worker, shown on the approval card. */
  rationale: string | null;
};

export type QuoteItem = Base & {
  quote_id: string;
  service_id: string | null;
  description: string;
  is_custom: boolean;
  crew_size: number;
  est_hours: number;
  price: number | null;
  status: QuoteItemStatus;
  partner_note: string | null;
  /** Claude's summary + suggested range for custom items (owner-only, never sent). */
  ai_summary: {
    summary: string;
    crew_size: number;
    hours_min: number;
    hours_max: number;
    price_min: number;
    price_max: number;
  } | null;
  sort_order: number;
};

export type Job = Base & {
  quote_id: string | null;
  customer_id: string;
  status: JobStatus;
  start_at: string | null;
  end_at: string | null;
  est_minutes: number;
  crew_size: number;
  paid: boolean;
  weather_hold: boolean;
  /** Set once the job is paid; the scheduler orders by this. */
  paid_at: string | null;
  deadline: string | null;
  /** From the scheduler: why this slot. Shown on the booking approval card. */
  schedule_reason: string | null;
  actual_minutes: number | null;
  started_at: string | null;
  completed_at: string | null;
  completion_photo_paths: string[];
  notes: string | null;
};

export type JobAssignment = Base & {
  job_id: string;
  crew_id: string;
  status: AssignmentStatus;
  responded_at: string | null;
  /** For swap_offered: who is being offered the swap. */
  swap_to_crew_id: string | null;
};

export type OwnerWindow = Base & {
  weekday: Weekday;
  start_time: string; // "08:00"
  end_time: string; // "17:00"
};

export type OwnerException = Base & {
  date: string; // YYYY-MM-DD
  closed: boolean;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
};

export type CrewAvailability = Base & {
  crew_id: string;
  weekday: Weekday;
  start_time: string;
  end_time: string;
};

export type CrewException = Base & {
  crew_id: string;
  date_from: string;
  date_to: string;
  start_time: string | null;
  end_time: string | null;
  kind: ExceptionKind;
  status: ExceptionStatus;
  note: string | null;
};

export type Approval = Base & {
  kind: ApprovalKind;
  ref_table: string;
  ref_id: string;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  created_by: string;
  decided_at: string | null;
  decided_by: string | null;
  /** Owner's edits / rejection note. */
  decision_note: string | null;
  title: string;
  summary: string | null;
};

export type Ad = Base & {
  channel: AdChannel;
  headline: string;
  body: string;
  cta: string | null;
  image_path: string | null;
  targeting: AdTargeting;
  utm_code: string;
  status: AdStatus;
  season: string | null;
  offer: string | null;
  posted_at: string | null;
};

export type Message = Base & {
  customer_id: string;
  job_id: string | null;
  quote_id: string | null;
  channel: MessageChannel;
  kind: MessageKind;
  subject: string | null;
  body: string;
  status: MessageStatus;
  sent_at: string | null;
  error: string | null;
  provider_id: string | null;
};

export type Payout = Base & {
  crew_id: string;
  job_id: string;
  hours: number;
  rate: number;
  amount: number;
  paid_cash_at: string | null;
};

export type Expense = Base & {
  date: string;
  category: string;
  amount: number;
  note: string | null;
};

export type AiUsage = Base & {
  task: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  est_cost: number;
  worker: string | null;
};

export type Settings = Base & {
  /** Single row; id is always `00000000-0000-0000-0000-000000000001`. */
  ai_monthly_cap: number | null;
  default_wage: number;
  margin: number;
  min_job_price: number | null;
  card_fee_pct: number;
  card_fee_fixed: number;
  drop_notice_hours: number;
  autopilot: AutopilotRules;
  quote_valid_days: number;
  /** Service-area centre for weather + distance. */
  base_lat: number | null;
  base_lng: number | null;
  partner_tree_service_name: string | null;
  partner_tree_service_email: string | null;
};

export const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

export type FleetWorker = Base & {
  name: string;
  role: FleetRole;
  last_heartbeat: string | null;
  cpu: number | null;
  ram: number | null;
  temp_c: number | null;
  current_task: string | null;
  last_error: string | null;
  version: string | null;
};

export type FleetTask = Base & {
  type: FleetTaskType;
  /** Which worker role may claim it. */
  role: FleetRole;
  payload: FleetTaskPayload;
  status: FleetTaskStatus;
  worker: string | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  started_at: string | null;
  finished_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  /** Optional idempotency key, unique when set. */
  dedupe_key: string | null;
};

export type StripeEvent = Base & {
  stripe_event_id: string;
  type: string;
  processed_at: string | null;
  payload: Record<string, unknown>;
};

// ---------- supabase-js Database generic ----------

type Table<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      services: Table<Service>;
      customers: Table<Customer>;
      leads: Table<Lead>;
      quotes: Table<Quote>;
      quote_items: Table<QuoteItem>;
      jobs: Table<Job>;
      job_assignments: Table<JobAssignment>;
      owner_windows: Table<OwnerWindow>;
      owner_exceptions: Table<OwnerException>;
      crew_availability: Table<CrewAvailability>;
      crew_exceptions: Table<CrewException>;
      approvals: Table<Approval>;
      ads: Table<Ad>;
      messages: Table<Message>;
      payouts: Table<Payout>;
      expenses: Table<Expense>;
      ai_usage: Table<AiUsage>;
      settings: Table<Settings>;
      fleet_workers: Table<FleetWorker>;
      fleet_tasks: Table<FleetTask>;
      stripe_events: Table<StripeEvent>;
    };
    Views: {
      /** Crew-safe view of jobs: no prices, no customer phone/email. */
      crew_jobs: {
        Row: {
          id: string;
          status: JobStatus;
          start_at: string | null;
          end_at: string | null;
          est_minutes: number;
          crew_size: number;
          weather_hold: boolean;
          customer_name: string;
          address: string | null;
          lat: number | null;
          lng: number | null;
          services: string[];
          notes: string | null;
          actual_minutes: number | null;
          started_at: string | null;
          completed_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      claim_task: { Args: { p_role: FleetRole; p_worker: string }; Returns: FleetTask[] };
      complete_task: { Args: { p_id: string; p_result: Record<string, unknown> | null }; Returns: undefined };
      fail_task: { Args: { p_id: string; p_error: string; p_retry_in?: string | null }; Returns: FleetTaskStatus };
      requeue_stale_tasks: { Args: { p_stale?: string }; Returns: number };
      current_role: { Args: Record<string, never>; Returns: Role | null };
      is_owner: { Args: Record<string, never>; Returns: boolean };
      ai_spend_this_month: { Args: Record<string, never>; Returns: number };
      enqueue_task: {
        Args: { p_type: FleetTaskType; p_role: FleetRole; p_payload: FleetTaskPayload; p_run_after?: string; p_dedupe_key?: string };
        Returns: string;
      };
    };
    Enums: {
      role: Role;
      lead_status: LeadStatus;
      quote_status: QuoteStatus;
      quote_item_status: QuoteItemStatus;
      job_status: JobStatus;
      assignment_status: AssignmentStatus;
      exception_kind: ExceptionKind;
      exception_status: ExceptionStatus;
      approval_kind: ApprovalKind;
      approval_status: ApprovalStatus;
      ad_channel: AdChannel;
      ad_status: AdStatus;
      message_channel: MessageChannel;
      message_kind: MessageKind;
      message_status: MessageStatus;
      fleet_role: FleetRole;
      fleet_task_type: FleetTaskType;
      fleet_task_status: FleetTaskStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T]["Row"];
export type CrewJob = Database["public"]["Views"]["crew_jobs"]["Row"];

export const DEFAULT_AUTOPILOT: AutopilotRules = {
  ad: { enabled: false },
  quote: { enabled: false, max_total: null },
  custom_item: { enabled: false },
  booking: { enabled: false },
  followup: { enabled: false },
  crew_change: { enabled: false },
  drop: { enabled: false },
  weather_hold: { enabled: false },
};
