/**
 * Minimal structured logger (P-8 WP-8.3). Emits one JSON object per line so the
 * platform log drain (Vercel / Datadog / etc.) can parse + alert on fields rather
 * than scraping free text. No PII by construction — callers pass explicit fields.
 *
 * Intentionally dependency-free: a real APM (Sentry) is wired separately at the
 * app boundary; this is the structured-log substrate everything else builds on.
 */
type Level = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

function emit(level: Level, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
