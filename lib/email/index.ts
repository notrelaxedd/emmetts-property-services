/**
 * Email + SMS delivery for the ops system.
 * Plain Node: no `server-only`, no `next/*`, no NEXT_PUBLIC_* (fleet workers on Node 20 import this).
 * Uses global `fetch`; no provider SDKs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Message, MessageKind } from "../db/types";
import { renderEmail, unsubscribeUrl } from "./render";
import { getSmsProvider } from "./sms";

export { renderEmail, unsubscribeUrl, escapeHtml } from "./render";
export { getSmsProvider } from "./sms";
export type { SmsProvider, OutboundSms } from "./sms";

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Falls back to EMAIL_FROM. */
  from?: string;
  replyTo?: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
};

export type EmailProvider = { send(msg: OutboundEmail): Promise<{ id: string | null }> };

function requireFrom(msg: OutboundEmail): string {
  const from = msg.from ?? process.env.EMAIL_FROM;
  if (!from) {
    // TODO [sending domain — ask owner]: set EMAIL_FROM, e.g. "Emmett's <hello@yourdomain>".
    throw new Error("EMAIL_FROM is required for real email providers (TODO [sending domain])");
  }
  return from;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, label: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new Error(`${label} ${res.status}: ${raw.slice(0, 300)}`);
  return json;
}

const logProvider: EmailProvider = {
  async send(msg) {
    const preview = msg.text.replace(/\s+/g, " ").trim().slice(0, 80);
    console.log(`[email:log] to=${msg.to} subject=${JSON.stringify(msg.subject)} body=${JSON.stringify(preview)}`);
    return { id: null };
  },
};

const resendProvider: EmailProvider = {
  async send(msg) {
    const from = requireFrom(msg);
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
    const json = await postJson(
      "https://api.resend.com/emails",
      { Authorization: `Bearer ${key}` },
      {
        from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        reply_to: msg.replyTo,
        headers: msg.headers,
      },
      "Resend",
    );
    return { id: typeof json.id === "string" ? json.id : null };
  },
};

const postmarkProvider: EmailProvider = {
  async send(msg) {
    const from = requireFrom(msg);
    const token = process.env.POSTMARK_SERVER_TOKEN;
    if (!token) throw new Error("POSTMARK_SERVER_TOKEN is required when EMAIL_PROVIDER=postmark");
    const json = await postJson(
      "https://api.postmarkapp.com/email",
      { "X-Postmark-Server-Token": token },
      {
        From: from,
        To: msg.to,
        Subject: msg.subject,
        TextBody: msg.text,
        HtmlBody: msg.html,
        ReplyTo: msg.replyTo,
        Headers: msg.headers ? Object.entries(msg.headers).map(([Name, Value]) => ({ Name, Value })) : undefined,
        MessageStream: "outbound",
      },
      "Postmark",
    );
    return { id: typeof json.MessageID === "string" ? json.MessageID : null };
  },
};

export function getEmailProvider(): EmailProvider {
  const name = process.env.EMAIL_PROVIDER ?? "log";
  switch (name) {
    case "log":
      return logProvider;
    case "resend":
      return resendProvider;
    case "postmark":
      return postmarkProvider;
    case "smtp":
      // TODO [EMAIL PROVIDER — ask owner]: SMTP would need a dependency (nodemailer); not added.
      throw new Error("TODO [EMAIL PROVIDER]: smtp not configured");
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${name}" (expected log | resend | postmark | smtp)`);
  }
}

/**
 * Marketing kinds need explicit opt-in; transactional kinds do not (the customer asked for the quote).
 * - transactional: quote, confirmation, reminder, referral, decline
 * - marketing: review, snow, and (conservatively) custom owner-written messages
 */
export function requiresOptIn(kind: MessageKind): boolean {
  switch (kind) {
    case "quote":
    case "confirmation":
    case "reminder":
    case "referral":
    case "decline":
      return false;
    case "review":
    case "snow":
    case "custom":
    default:
      return true;
  }
}

export type SendMessageResult =
  | { status: "sent"; providerId: string | null }
  | { status: "cancelled"; error: string }
  | { status: "failed"; error: string };

export async function sendMessage(
  db: SupabaseClient<Database>,
  messageId: string,
  opts: { siteUrl: string; business?: string },
): Promise<SendMessageResult> {
  const { data: msg, error: msgErr } = await db.from("messages").select("*").eq("id", messageId).maybeSingle();
  if (msgErr) throw new Error(`messages lookup failed: ${msgErr.message}`);
  if (!msg) throw new Error(`message ${messageId} not found`);

  const finish = async (patch: Partial<Message>) => {
    const { error } = await db.from("messages").update(patch).eq("id", messageId);
    if (error) throw new Error(`messages update failed: ${error.message}`);
  };
  const cancel = async (reason: string): Promise<SendMessageResult> => {
    await finish({ status: "cancelled", error: reason });
    return { status: "cancelled", error: reason };
  };

  if (msg.status === "sent") return { status: "sent", providerId: msg.provider_id };

  const { data: customer, error: custErr } = await db
    .from("customers")
    .select("*")
    .eq("id", msg.customer_id)
    .maybeSingle();
  if (custErr) throw new Error(`customers lookup failed: ${custErr.message}`);
  if (!customer) return cancel("customer not found");

  const business = opts.business ?? process.env.BUSINESS_NAME ?? "Emmett's Property Services";

  try {
    if (msg.channel === "email") {
      if (!customer.email) return cancel("customer has no email address");
      if (requiresOptIn(msg.kind) && !customer.email_opt_in) return cancel("customer is not opted in to email");

      const subject = msg.subject ?? `A note from ${business}`;
      const { text, html } = renderEmail({
        subject,
        body: msg.body,
        siteUrl: opts.siteUrl,
        token: customer.unsubscribe_token,
        business,
      });
      const unsub = unsubscribeUrl(opts.siteUrl, customer.unsubscribe_token);
      const { id } = await getEmailProvider().send({
        to: customer.email,
        subject,
        text,
        html,
        headers: {
          // RFC 8058 one-click: mail clients show a native unsubscribe button and POST to the one-click route.
          "List-Unsubscribe": `<${unsub.replace("/unsubscribe?", "/unsubscribe/one-click?")}>, <${unsub}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      await finish({ status: "sent", sent_at: new Date().toISOString(), provider_id: id, error: null });
      return { status: "sent", providerId: id };
    }

    // sms: texts only to sms_opt_in customers, always (see docs/PLAN.md "Rules for every worker").
    if (!customer.phone) return cancel("customer has no phone number");
    if (!customer.sms_opt_in) return cancel("customer is not opted in to SMS");
    const { id } = await getSmsProvider().send({ to: customer.phone, body: msg.body });
    await finish({ status: "sent", sent_at: new Date().toISOString(), provider_id: id, error: null });
    return { status: "sent", providerId: id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await finish({ status: "failed", error });
    return { status: "failed", error };
  }
}
