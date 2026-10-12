import { withWorkerName } from "../lib/ai/claude";
import type { FleetRole } from "../lib/db/types";
import type { Db } from "../lib/ops/types";
import type { Logger } from "./log";

export type AiHelpers = Omit<ReturnType<typeof withWorkerName>, "worker">;

/** Everything a task needs. Built once per worker; tests build their own. */
export type TaskContext = {
  db: Db;
  /** This worker's name (`fleet_workers.name`, `approvals.created_by`, `ai_usage.worker`). */
  worker: string;
  role: FleetRole;
  siteUrl: string;
  ai: AiHelpers;
  log: Logger;
  now: () => Date;
};

export function aiFor(worker: string): AiHelpers {
  const { worker: _w, ...helpers } = withWorkerName(worker);
  return helpers;
}
