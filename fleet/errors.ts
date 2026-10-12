/**
 * Thrown for failures a retry cannot fix (bad payload, missing row). The worker marks the task
 * `failed` straight away instead of burning its remaining attempts.
 */
export class PermanentTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentTaskError";
  }
}
