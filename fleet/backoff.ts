/** Retry delay after a failed attempt: min(2^attempts, 60) minutes. `attempts` counts this one. */
export function backoffMinutes(attempts: number): number {
  const n = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
  return Math.min(2 ** n, 60);
}

/** The same delay as a Postgres interval literal for `fail_task(p_retry_in)`. */
export function backoffInterval(attempts: number): string {
  return `${backoffMinutes(attempts)} minutes`;
}
