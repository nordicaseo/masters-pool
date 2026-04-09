/**
 * Structured error logger. Every catch block in the app must call this
 * (or return an error response that goes through it). See CLAUDE.md
 * "Error Handling — No Silent Failures" for the rule and rationale.
 *
 * On Vercel these surface in the Functions log and are searchable by
 * the `subsystem` and `operation` fields.
 */

export type LogContext = {
  subsystem: string;
  operation: string;
  extra?: Record<string, unknown>;
};

export function logError(error: unknown, ctx: LogContext): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(
    JSON.stringify({
      level: 'error',
      subsystem: ctx.subsystem,
      operation: ctx.operation,
      message: err.message,
      stack: err.stack,
      extra: ctx.extra ?? {},
      ts: new Date().toISOString(),
    }),
  );
}

export function logInfo(message: string, ctx: Omit<LogContext, 'extra'> & { extra?: Record<string, unknown> }): void {
  console.log(
    JSON.stringify({
      level: 'info',
      subsystem: ctx.subsystem,
      operation: ctx.operation,
      message,
      extra: ctx.extra ?? {},
      ts: new Date().toISOString(),
    }),
  );
}
