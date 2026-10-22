/**
 * Helpers for `scripts/supabase-email-templates.ts` (`npm run supabase:emails`). The templates themselves are
 * plain HTML in `supabase/templates/`, so they can also be pasted into the Supabase dashboard by hand.
 * Pure functions: no network, no env reads, never prints the access token.
 */

export type AuthEmailTemplate = {
  /** File in supabase/templates/ (without .html), and the name in the Management API's `mailer_*` keys. */
  name: string;
  /** Dashboard label, so the README and the script output match what the owner sees. */
  label: string;
  subject: string;
  /** Variables the email is useless without. */
  requires: string[];
  /** Security notifications are off by default in Supabase; the script turns these on. */
  notification?: boolean;
};

export const AUTH_EMAIL_TEMPLATES: AuthEmailTemplate[] = [
  { name: "invite", label: "Invite user", subject: "You're invited to the Emmett's crew app", requires: ["ConfirmationURL"] },
  { name: "magic_link", label: "Magic link", subject: "Your sign-in link for Emmett's Property Services", requires: ["ConfirmationURL"] },
  { name: "recovery", label: "Reset password", subject: "Reset your Emmett's Property Services password", requires: ["ConfirmationURL"] },
  { name: "email_change", label: "Change email address", subject: "Confirm your new email address", requires: ["ConfirmationURL", "NewEmail"] },
  { name: "confirmation", label: "Confirm sign up", subject: "Confirm your email address", requires: ["ConfirmationURL"] },
  { name: "reauthentication", label: "Reauthentication", subject: "{{ .Token }} is your verification code", requires: ["Token"] },
  {
    name: "password_changed_notification",
    label: "Password changed",
    subject: "Your Emmett's Property Services password was changed",
    requires: [],
    notification: true,
  },
];

/** Variables Supabase only fills in for one template; anywhere else they render empty. */
const ONLY_IN: Record<string, string> = { NewEmail: "email_change" };

/** `{{ .Name }}` and `{{ .Data.name }}` references in a template (top-level name only). */
export function templateVariables(html: string): Set<string> {
  const vars = new Set<string>();
  const re = /\{\{-?\s*(?:if\s+|else\s+if\s+)?\.([A-Za-z]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) vars.add(m[1]);
  return vars;
}

/** Problems with one template's HTML, as human-readable strings. Empty = fine. */
export function checkTemplate(t: AuthEmailTemplate, html: string): string[] {
  const problems: string[] = [];
  const vars = templateVariables(html);
  for (const v of t.requires) if (!vars.has(v)) problems.push(`${t.name}: missing {{ .${v} }}`);
  for (const [v, only] of Object.entries(ONLY_IN)) {
    if (vars.has(v) && t.name !== only) problems.push(`${t.name}: {{ .${v} }} is only set in ${only}`);
  }
  const opens = (html.match(/\{\{-?\s*if\b/g) ?? []).length;
  const ends = (html.match(/\{\{-?\s*end\s*-?\}\}/g) ?? []).length;
  if (opens !== ends) problems.push(`${t.name}: ${opens} {{ if }} but ${ends} {{ end }}`);
  if ((html.match(/\{\{/g) ?? []).length !== (html.match(/\}\}/g) ?? []).length) problems.push(`${t.name}: unbalanced {{ }}`);
  return problems;
}

/** Body for `PATCH /v1/projects/{ref}/config/auth`. `read(name)` returns the template's HTML. */
export function buildAuthConfigPatch(read: (name: string) => string): Record<string, string | boolean> {
  const body: Record<string, string | boolean> = {};
  for (const t of AUTH_EMAIL_TEMPLATES) {
    body[`mailer_subjects_${t.name}`] = t.subject;
    body[`mailer_templates_${t.name}_content`] = read(t.name);
    if (t.notification) body[`mailer_notifications_${t.name.replace(/_notification$/, "")}_enabled`] = true;
  }
  return body;
}

/** "https://abcd1234.supabase.co" -> "abcd1234". Null for custom domains or anything else. */
export function projectRefFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const m = new URL(url).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
