/**
 * Push the branded auth emails in supabase/templates/ to the hosted Supabase project. Run it on your own
 * machine (it needs to reach api.supabase.com):
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:emails -- --project-ref abcd1234efgh5678ijkl
 *
 * The access token is a personal one from https://supabase.com/dashboard/account/tokens (not the service-role
 * key). The project ref defaults to the one in NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL. `--dry-run` checks the
 * templates and prints what would change without calling the API. Re-running is safe: it overwrites the same
 * settings. Never prints the token. Helpers and tests: lib/auth/email-templates.ts. Docs: supabase/README.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { AUTH_EMAIL_TEMPLATES, buildAuthConfigPatch, checkTemplate, projectRefFromUrl } from "../lib/auth/email-templates";

const USAGE = `Usage: SUPABASE_ACCESS_TOKEN=sbp_… npx tsx scripts/supabase-email-templates.ts [--project-ref <ref>] [--dry-run]`;
const TEMPLATE_DIR = path.join(__dirname, "..", "supabase", "templates");

function parseArgs(argv: string[]) {
  const out = { ref: null as string | null, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--project-ref") out.ref = argv[++i] ?? null;
    else if (a.startsWith("--project-ref=")) out.ref = a.slice("--project-ref=".length);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const read = (name: string) => readFileSync(path.join(TEMPLATE_DIR, `${name}.html`), "utf8");
  const problems = AUTH_EMAIL_TEMPLATES.flatMap((t) => checkTemplate(t, read(t.name)));
  if (problems.length) {
    for (const p of problems) console.error(`! ${p}`);
    return 1;
  }
  const body = buildAuthConfigPatch(read);

  console.log("Templates:");
  for (const t of AUTH_EMAIL_TEMPLATES) console.log(`  ${t.label.padEnd(22)} "${t.subject}"${t.notification ? " (notification turned on)" : ""}`);

  const ref = args.ref ?? projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? projectRefFromUrl(process.env.SUPABASE_URL);
  if (args.dryRun) {
    console.log(`\nDry run: would PATCH ${Object.keys(body).length} auth settings on project ${ref ?? "<ref>"}.`);
    return 0;
  }
  if (!ref) {
    console.error("Pass --project-ref <ref> (Dashboard → Project Settings → General), or set NEXT_PUBLIC_SUPABASE_URL.");
    console.error(USAGE);
    return 2;
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) {
    console.error("Set SUPABASE_ACCESS_TOKEN to a personal access token from https://supabase.com/dashboard/account/tokens.");
    return 1;
  }

  const res = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Supabase said ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return 1;
  }
  console.log(`\nUpdated ${AUTH_EMAIL_TEMPLATES.length} email templates on project ${ref}.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
