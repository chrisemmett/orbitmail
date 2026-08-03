// What to do about an exception nobody caught.
//
// The handler existed to swallow one specific nuisance — IMAP sockets that time
// out and surface as an uncaught error rather than a rejected promise — but it
// swallowed *everything*, logging to a console the user never sees and carrying
// on. After an uncaught exception the process state is unknown by definition:
// a sync may have stopped half way, a connection lane may still be held. The
// app carrying on as though nothing happened is a guess, and a silent one.
//
// Killing the app instead would be worse for a mail client: a stray error in a
// background timer would take the user's session with it. So: keep the narrow
// suppression, and for anything else tell the user, once, that a restart is
// wise — then let them choose when.

/**
 * IMAP sockets time out during normal operation, and imapflow surfaces some of
 * those as uncaught errors. They are noise, not news: the pool reconnects.
 */
export function isBenignSocketError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = 'code' in err ? String((err as { code?: unknown }).code) : ''
  if (code === 'ETIMEOUT' || code === 'ETIMEDOUT') return true
  const message = 'message' in err ? String((err as { message?: unknown }).message) : ''
  return message === 'Socket timeout'
}

/**
 * What the renderer sends when it has fallen over, and what gets written down.
 *
 * The reason this exists: a renderer that throws during render leaves a white
 * window and a *live* process, so nothing crashes, nothing is logged, and the
 * only evidence is a console the user cannot see. The next occurrence has to
 * leave something behind or it is unfixable — hence a file, not a console line.
 */
export interface RendererErrorReport {
  /** 'render' (an error boundary caught it) or 'window' (the process died). */
  source: 'render' | 'window'
  message: string
  stack?: string
  /** React's component stack, when an error boundary supplied one. */
  componentStack?: string
  /** Which window it came from, so a composer crash is distinguishable. */
  window?: string
}

/** How much of the error log to keep. Old entries are dropped from the front. */
export const ERROR_LOG_MAX_BYTES = 64 * 1024

/** One entry, as it is written to the log. Timestamped so "when" is answerable. */
export function formatErrorLogEntry(report: RendererErrorReport, at: number): string {
  const lines = [
    `[${new Date(at).toISOString()}] ${report.source}${report.window ? ` (${report.window})` : ''}: ${report.message}`
  ]
  if (report.stack) lines.push(report.stack.trim())
  if (report.componentStack) lines.push(`component stack:${report.componentStack.trimEnd()}`)
  return lines.join('\n') + '\n\n'
}

/**
 * Append an entry, keeping the log bounded. Trimming drops whole entries from
 * the front rather than cutting mid-line, because half a stack trace read as a
 * different error the last time a log did this.
 */
export function appendToErrorLog(existing: string, entry: string): string {
  const combined = existing + entry
  if (combined.length <= ERROR_LOG_MAX_BYTES) return combined

  const entries = combined.split('\n\n').filter((e) => e.trim().length > 0)
  // Always keep the newest entry, even if it alone exceeds the budget: a log
  // that discards the thing it was just told about is worse than an oversized one.
  const kept: string[] = [entries[entries.length - 1]]
  let size = kept[0].length + 2
  for (let i = entries.length - 2; i >= 0; i--) {
    const next = entries[i].length + 2
    if (size + next > ERROR_LOG_MAX_BYTES) break
    kept.unshift(entries[i])
    size += next
  }
  return kept.join('\n\n') + '\n\n'
}

/** One line for the user: what happened, and what it means for them. */
export function describeUnexpectedError(err: unknown): string {
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message)
      : String(err)
  const trimmed = message.trim().slice(0, 200)
  return trimmed.length > 0
    ? `Orbit Mail hit an unexpected error (${trimmed}). Mail is safe, but restart when convenient.`
    : 'Orbit Mail hit an unexpected error. Mail is safe, but restart when convenient.'
}
