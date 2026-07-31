import { getLatestInboxMessage, type LatestInboxMessage } from './db-service'
import { getAppState } from './preferences-service'

/**
 * Whether to interrupt the user about newly-arrived mail, and about what.
 *
 * This exists as its own unit because the decision has three parts that were
 * previously tangled together in `main.ts`, only one of which was actually
 * being made:
 *
 * 1. **Does the user want interrupting at all** (the preference).
 * 2. **Have we already said this** — the part that was missing. Two independent
 *    paths announce new mail: the IDLE push handler, and the safety-net poll
 *    that runs every 90s for IDLE-capable accounts with `announce` defaulting
 *    true. One arrival reaches both whenever the poll's estimate is taken before
 *    IDLE has stored the message, so the same email was announced twice.
 * 3. **Are we being noisy** — a rate limit, so a burst of arrivals is one
 *    notification rather than a machine-gun.
 *
 * The old guard was (3) alone, a five-second wall clock. That is not a dedupe:
 * it collapses duplicates that happen to be close together and lets through the
 * ones that are not, which is exactly the case here — the poll's pass takes
 * seconds, so the second announcement usually landed *outside* the window.
 *
 * Keyed on the message id rather than a timestamp because "the newest inbox
 * message is still the one I already announced" is the actual question. Mail
 * that arrives while muted or blocked never reaches here: `getLatestInboxMessage`
 * filters both, and a null from it means everything recent is from someone the
 * user asked not to be interrupted about.
 */

/** How close together two *different* arrivals may be announced. */
const RATE_LIMIT_MS = 5000

let lastNotifiedId: string | null = null
let lastNotifiedAt = 0

export interface NewMailNotice {
  message: LatestInboxMessage
  /** How many messages arrived in the batch this notice is announcing. */
  count: number
}

/**
 * Claim the right to notify, or decline.
 *
 * Named `take` because it is not a predicate: a truthy result records that this
 * message has been announced, so the caller must actually show it. `now` is a
 * parameter so the rate limit can be tested without waiting on a clock.
 */
export function takeNewMailNotice(count: number, now = Date.now()): NewMailNotice | null {
  if (getAppState().desktopNotifications === false) return null

  const message = getLatestInboxMessage()
  if (!message) return null

  // Already announced. Not rate limiting — this stays true an hour later, which
  // is the whole point: the duplicate can arrive well outside any time window.
  if (message.id === lastNotifiedId) return null

  if (now - lastNotifiedAt < RATE_LIMIT_MS) return null

  lastNotifiedId = message.id
  lastNotifiedAt = now
  return { message, count }
}

/** Test hook: forget what has been announced. */
export function resetNewMailNoticeForTests(): void {
  lastNotifiedId = null
  lastNotifiedAt = 0
}
