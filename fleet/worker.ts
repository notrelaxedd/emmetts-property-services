/**
 * Fleet worker entry point: one binary, role from FLEET_ROLE (ads | quotes | scheduler | followup | host).
 *
 *   FLEET_ROLE=quotes SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx fleet/worker.ts
 *
 * See fleet/README.md for the env vars and the systemd setup. Logs go to stdout (journald), never files.
 */
import "../lib/ops/handlers"; // registers approval side effects for applyApproval (autopilot)
import { aiFor } from "./context";
import type { TaskContext } from "./context";
import { createFleetDb } from "./db";
import { AI_ROLES, parseEnv } from "./env";
import { resolveVersion } from "./heartbeat";
import { createLogger, errorMessage } from "./log";
import { runWorker } from "./runtime";

/** After SIGTERM, a running task gets this long to finish before we exit anyway (systemd waits 60 s). */
const STOP_GRACE_MS = 45_000;

async function main(): Promise<void> {
  let env;
  try {
    env = parseEnv();
  } catch (e) {
    process.stderr.write(`FATAL ${errorMessage(e)}\n`);
    process.exit(2);
  }
  const log = createLogger({ w: env.name });
  const version = resolveVersion();
  if (AI_ROLES.has(env.role) && !env.hasAnthropicKey) {
    log.warn("ANTHROPIC_API_KEY is not set: AI drafts will fail (follow-ups fall back to templates)");
  }

  const ctx: TaskContext = {
    db: createFleetDb(env.supabaseUrl, env.serviceRoleKey),
    worker: env.name,
    role: env.role,
    siteUrl: env.siteUrl,
    ai: aiFor(env.name),
    log,
    now: () => new Date(),
  };

  const stop = new AbortController();
  let firstSignalAt = 0;
  const onSignal = (sig: string) => {
    if (stop.signal.aborted) {
      // tsx relays the signal to this process; ignore the echo, honour a deliberate second one.
      if (Date.now() - firstSignalAt < 2_000) return;
      log.warn("second signal, exiting now", { sig });
      process.exit(1);
    }
    firstSignalAt = Date.now();
    log.info("stopping", { sig });
    stop.abort();
    setTimeout(() => {
      log.error("task did not finish in time, exiting (the host requeues it)");
      process.exit(1);
    }, STOP_GRACE_MS).unref();
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("unhandledRejection", (e) => log.error("unhandled rejection", { err: errorMessage(e) }));

  log.info("starting", { role: env.role, version, site: env.siteUrl, node: process.version });
  await runWorker({ ctx, version }, stop.signal);
  log.info("stopped");
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`FATAL ${errorMessage(e)}\n`);
  process.exit(1);
});
