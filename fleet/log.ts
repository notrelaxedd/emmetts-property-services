/**
 * Compact single-line logs to stdout/stderr (journald on the boxes). Never writes files.
 *
 *   log.info("claimed", { task: "quote", id: "1a2b3c4d" })  ->  INFO claimed task=quote id=1a2b3c4d
 *
 * Under systemd (JOURNAL_STREAM is set) journald adds the timestamp; elsewhere we prefix one.
 */
export type LogFields = Record<string, unknown>;
export type Logger = {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
};

const MAX_VALUE = 300;

function fmtValue(v: unknown): string {
  let s: string;
  if (v instanceof Error) s = v.message;
  else if (typeof v === "string") s = v;
  else if (v === undefined) s = "";
  else s = JSON.stringify(v) ?? String(v);
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > MAX_VALUE) s = `${s.slice(0, MAX_VALUE)}…`;
  return /[\s="]/.test(s) || s === "" ? JSON.stringify(s) : s;
}

export function formatLine(level: string, msg: string, fields: LogFields = {}): string {
  const kv = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${fmtValue(v)}`)
    .join(" ");
  return `${level} ${msg}${kv ? ` ${kv}` : ""}`;
}

export function createLogger(base: LogFields = {}, opts: { timestamps?: boolean } = {}): Logger {
  const stamp = opts.timestamps ?? !process.env.JOURNAL_STREAM;
  const write = (level: string, msg: string, fields?: LogFields) => {
    const line = formatLine(level, msg, { ...base, ...fields });
    const out = stamp ? `${new Date().toISOString()} ${line}` : line;
    if (level === "ERROR" || level === "WARN") process.stderr.write(`${out}\n`);
    else process.stdout.write(`${out}\n`);
  };
  return {
    info: (m, f) => write("INFO", m, f),
    warn: (m, f) => write("WARN", m, f),
    error: (m, f) => write("ERROR", m, f),
    child: (f) => createLogger({ ...base, ...f }, opts),
  };
}

/** A logger that drops everything (tests). */
export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
}
