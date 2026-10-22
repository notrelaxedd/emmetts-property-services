/** Box metrics + the `fleet_workers` heartbeat upsert (one row per worker, keyed by name). */
import { readFileSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import type { FleetRole } from "../lib/db/types";
import { check } from "../lib/ops/types";
import type { Db } from "../lib/ops/types";

export const THERMAL_PATH = "/sys/class/thermal/thermal_zone0/temp";
/** Written by older hosts when a worker went quiet (hosts now delete the row); cleared by the next heartbeat. */
export const OFFLINE_ERROR = "no heartbeat";

export type Metrics = { cpu: number; ram: number; temp_c: number | null };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** CPU % = 1-minute load average / cores (capped at 100); RAM % used; SoC temperature if readable. */
export function readMetrics(thermalPath = THERMAL_PATH): Metrics {
  const cores = Math.max(1, cpus().length);
  const cpu = Math.min(100, (loadavg()[0] / cores) * 100);
  const total = totalmem();
  const ram = total > 0 ? (1 - freemem() / total) * 100 : 0;
  return { cpu: round1(cpu), ram: round1(ram), temp_c: readTemp(thermalPath) };
}

/** Millidegrees C from sysfs → °C, or null when the file is missing / unreadable / junk. */
export function readTemp(path = THERMAL_PATH): number | null {
  try {
    const milli = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isFinite(milli) ? round1(milli / 1000) : null;
  } catch {
    return null;
  }
}

/** FLEET_VERSION / GIT_SHA env, else the checkout's HEAD sha (short), else package.json version. */
export function resolveVersion(root = process.env.FLEET_ROOT ?? process.cwd(), env: Record<string, string | undefined> = process.env): string | null {
  const fromEnv = env.FLEET_VERSION?.trim() || env.GIT_SHA?.trim();
  if (fromEnv) return fromEnv.slice(0, 40);
  try {
    const head = readFileSync(join(root, ".git", "HEAD"), "utf8").trim();
    const ref = head.startsWith("ref: ") ? head.slice(5) : null;
    const sha = ref ? readFileSync(join(root, ".git", ref), "utf8").trim() : head;
    if (/^[0-9a-f]{7,40}$/.test(sha)) return sha.slice(0, 7);
  } catch {
    /* packed refs / no .git: fall through */
  }
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
    return pkg.version ? `v${pkg.version}` : null;
  } catch {
    return null;
  }
}

export type HeartbeatInput = {
  name: string;
  role: FleetRole;
  currentTask: string | null;
  version: string | null;
  metrics?: Metrics;
  now?: Date;
};

export async function heartbeat(db: Db, input: HeartbeatInput): Promise<void> {
  const m = input.metrics ?? readMetrics();
  check(
    await db.from("fleet_workers").upsert(
      {
        name: input.name,
        role: input.role,
        last_heartbeat: (input.now ?? new Date()).toISOString(),
        cpu: m.cpu,
        ram: m.ram,
        temp_c: m.temp_c,
        current_task: input.currentTask,
        version: input.version,
      },
      { onConflict: "name" },
    ),
    "heartbeat",
  );
  // Back after the host marked us offline: clear that note (real task errors are left alone).
  check(
    await db.from("fleet_workers").update({ last_error: null }).eq("name", input.name).eq("last_error", OFFLINE_ERROR),
    "heartbeat(clear offline)",
  );
}

/** Record a failure on the worker row for the Fleet panel. */
export async function setLastError(db: Db, name: string, message: string): Promise<void> {
  check(await db.from("fleet_workers").update({ last_error: message.slice(0, 500) }).eq("name", name), "fleet_workers(last_error)");
}
