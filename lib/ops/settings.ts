import { DEFAULT_AUTOPILOT, SETTINGS_ID } from "../db/types";
import type { AutopilotRules, Settings } from "../db/types";
import { check, one } from "./types";
import type { Db } from "./types";

export type SettingsPatch = Partial<Omit<Settings, "id" | "created_at" | "updated_at" | "autopilot">> & {
  /** Per-kind partial: `{ quote: { enabled: true } }` keeps `max_total`. */
  autopilot?: { [K in keyof AutopilotRules]?: Partial<AutopilotRules[K]> };
};

/** Merge a (possibly partial / null) stored autopilot blob over the defaults. */
export function mergeAutopilot(stored: unknown, over?: SettingsPatch["autopilot"]): AutopilotRules {
  const base = (stored && typeof stored === "object" ? stored : {}) as Record<string, object | undefined>;
  const patch = (over ?? {}) as Record<string, object | undefined>;
  const out: Record<string, object> = {};
  for (const k of Object.keys(DEFAULT_AUTOPILOT)) {
    out[k] = {
      ...(DEFAULT_AUTOPILOT as Record<string, object>)[k],
      ...(base[k] ?? {}),
      ...(patch[k] ?? {}),
    };
  }
  return out as AutopilotRules;
}

/** Reads the single settings row. `autopilot` is merged over `DEFAULT_AUTOPILOT` so missing keys are safe. */
export async function getSettings(db: Db): Promise<Settings> {
  const row = check(await db.from("settings").select("*").eq("id", SETTINGS_ID).maybeSingle(), "getSettings");
  if (!row) throw new Error("getSettings: settings row is missing (seed migration not applied?)");
  return { ...row, autopilot: mergeAutopilot(row.autopilot) };
}

/** Updates the settings row and returns it. `autopilot` is merged per kind, not replaced. */
export async function updateSettings(db: Db, patch: SettingsPatch): Promise<Settings> {
  const { autopilot, ...rest } = patch;
  const update: Partial<Settings> = { ...rest };
  if (autopilot) {
    const current = await getSettings(db);
    update.autopilot = mergeAutopilot(current.autopilot, autopilot);
  }
  if (Object.keys(update).length === 0) return getSettings(db);
  const row = one(
    await db.from("settings").update(update).eq("id", SETTINGS_ID).select("*").single(),
    "updateSettings",
  );
  return { ...row, autopilot: mergeAutopilot(row.autopilot) };
}
