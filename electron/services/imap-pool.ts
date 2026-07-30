import type { ImapFlow } from 'imapflow'
import type { Provider } from '../../shared/types'
import { createImapClient } from './imap-sync'

// A per-account pooled IMAP client. Every server op used to be a full
// connect+auth+logout cycle, so marking N messages meant N connections. Instead
// we keep one client per account alive between operations, serialize operations
// per account (imapflow is single-op-at-a-time), and close the client after a
// short idle period.
//
// This pool is deliberately separate from the IDLE monitor's persistent client
// (imap-idle.ts): IDLE holds the inbox in a push state, and borrowing it for
// arbitrary mutations would fight that. Two connections per account is an
// acceptable trade for keeping IDLE and mutation/sync paths independent.

// How long a pooled client is kept after the last operation. A cold open costs
// ~130ms against a loopback server with no TLS, which is the floor: a real server
// adds TCP, TLS and auth round trips, and Gmail adds a token refresh when the
// access token has expired. Holding the connection for five minutes turns the
// common case — a burst of clicks spread over a few minutes — into one connect
// instead of one per gap. Gmail allows 15 simultaneous IMAP connections and this
// app uses two per account (this pool plus the IDLE monitor), so the cost is
// connections we are well inside our budget for.
const IDLE_CLOSE_MS = 300_000

/**
 * How long a pooled client may sit idle before it is probed rather than trusted.
 *
 * A connection can die without either end noticing — a NAT or firewall dropping
 * it without a FIN leaves a *half-open* socket, where `usable` is still true and
 * the next real operation hangs until it times out and then fails. That failure
 * lands on whatever the user just clicked. Raising IDLE_CLOSE_MS makes it more
 * likely, so the two changes belong together.
 */
let probeAfterMs = 60_000

/**
 * The probe is bounded because the failure it detects is a *hang*. IMAP clients
 * here are created without a socket timeout, so an unbounded NOOP on a half-open
 * socket would wait as long as the operation it was meant to protect.
 */
const PROBE_TIMEOUT_MS = 3_000

/** Test hook: shorten the idle threshold so a probe can be provoked. */
export function setProbeAfterMsForTests(ms: number): void {
  probeAfterMs = ms
}

interface Lane {
  // Promise chain that serializes operations for this account.
  chain: Promise<unknown>
  client: ImapFlow | null
  provider: Provider
  idleTimer: ReturnType<typeof setTimeout> | null
  /** When the last operation on this lane finished, for the staleness probe. */
  lastUsedAt: number
}

const lanes = new Map<string, Lane>()

function getLane(accountId: string, provider: Provider): Lane {
  let lane = lanes.get(accountId)
  if (!lane) {
    lane = { chain: Promise.resolve(), client: null, provider, idleTimer: null, lastUsedAt: 0 }
    lanes.set(accountId, lane)
  } else {
    lane.provider = provider
  }
  return lane
}

function clearIdleTimer(lane: Lane): void {
  if (lane.idleTimer) {
    clearTimeout(lane.idleTimer)
    lane.idleTimer = null
  }
}

/**
 * `logout()` waits for the server to answer, which a dead connection never does.
 *
 * The polite close is worth keeping — it releases the session server-side instead
 * of leaving it to time out — but it cannot be unbounded: on a half-open socket
 * it hangs as long as the operation it is cleaning up after. Measured at 300s
 * before this was bounded, with the caller's click waiting on it.
 */
const LOGOUT_TIMEOUT_MS = 2_000

async function closeLaneClient(lane: Lane, graceful = true): Promise<void> {
  const client = lane.client
  lane.client = null
  if (!client) return

  if (graceful) {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        client.logout(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('logout timed out')), LOGOUT_TIMEOUT_MS)
        })
      ])
      return
    } catch {
      // Fall through to the abrupt close.
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  try {
    client.close()
  } catch {
    // already gone
  }
}

function scheduleIdleClose(accountId: string, lane: Lane): void {
  clearIdleTimer(lane)
  lane.idleTimer = setTimeout(() => {
    lane.idleTimer = null
    void closeLaneClient(lane)
  }, IDLE_CLOSE_MS)
}

/**
 * Can this client be used again? If not, its socket is closed before we let go
 * of it.
 *
 * `usable` goes false the moment a protocol error is seen, which is *before*
 * the `close` event fires — and on a half-open TCP connection it may never
 * fire. Simply overwriting the reference, as this used to, leaked both the
 * local socket and the server-side connection slot: Gmail allows 15 IMAP
 * connections per account and the app budgets 2, so leaking them steadily is
 * how an account ends up refusing new ones.
 *
 * `close()` rather than `logout()`: the client is already unusable, so a polite
 * LOGOUT has nobody to talk to and would only risk hanging the lane on a dead
 * socket.
 */
export function reclaimClient(client: { usable: boolean; close: () => void } | null): boolean {
  if (!client) return false
  if (client.usable) return true
  try {
    client.close()
  } catch {
    // Already gone — nothing left to release.
  }
  return false
}

function attachHandlers(accountId: string, lane: Lane, client: ImapFlow): void {
  const drop = () => {
    if (lane.client === client) lane.client = null
  }
  client.on('close', drop)
  client.on('error', () => {
    // 'close' follows an error; swallow here so it doesn't become an
    // unhandled 'error' event on the EventEmitter.
  })
}

/**
 * Borrow the account's pooled IMAP client for a single operation. Operations on
 * the same account are serialized; the client is created on demand and reused
 * across calls, then closed after `IDLE_CLOSE_MS` of inactivity. If `fn` throws
 * (often a dropped connection), the client is closed so the next call reconnects.
 */
export function withImapClient<T>(
  accountId: string,
  provider: Provider,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const lane = getLane(accountId, provider)

  const connect = async (): Promise<void> => {
    // Drop the dead reference before the await, so nothing inspecting the lane
    // while we reconnect sees a client that is already closed.
    lane.client = null
    lane.client = await createImapClient(accountId, provider)
    attachHandlers(accountId, lane, lane.client)
  }

  /**
   * Is the pooled client actually still talking to the server?
   *
   * Only asked of a connection that has been idle a while, and only ever with a
   * NOOP: the user's operation must run exactly once, so nothing here retries
   * `fn`. Half of what goes through this pool is a mutation — move, delete,
   * append — and re-running one that had in fact reached the server would apply
   * it twice. A probe is idempotent; an arbitrary retry is not.
   */
  const isAlive = async (client: ImapFlow): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        client.noop(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS)
        })
      ])
      return true
    } catch {
      return false
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const run = async (): Promise<T> => {
    clearIdleTimer(lane)
    if (!reclaimClient(lane.client)) {
      await connect()
      // `>=`, not `>`: a threshold of zero means "always probe", and with `>` two
      // operations landing in the same millisecond skipped it — which showed up
      // as a test that failed one run in three, hanging for imapflow's full 300s
      // socket timeout on the operation the probe was there to protect.
    } else if (Date.now() - lane.lastUsedAt >= probeAfterMs) {
      // Idle long enough that the socket may have been dropped without either
      // end noticing. Better to spend one round trip here than to hand the user
      // a failed click.
      if (!(await isAlive(lane.client))) {
        // Already known dead, so skip the polite logout entirely rather than
        // waiting out its timeout as well.
        await closeLaneClient(lane, false)
        await connect()
      }
    }
    try {
      return await fn(lane.client)
    } catch (err) {
      await closeLaneClient(lane)
      throw err
    } finally {
      lane.lastUsedAt = Date.now()
      scheduleIdleClose(accountId, lane)
    }
  }

  // Queue behind any in-flight op for this account, regardless of its outcome.
  const result = lane.chain.then(run, run)
  lane.chain = result.catch(() => {})
  return result
}

/** Close and forget a single account's pooled connection (e.g. on removal). */
export async function closeAccountPool(accountId: string): Promise<void> {
  const lane = lanes.get(accountId)
  if (!lane) return
  clearIdleTimer(lane)
  lanes.delete(accountId)
  await closeLaneClient(lane)
}

/** Close every pooled connection (app shutdown). */
export async function closeAllPools(): Promise<void> {
  const all = Array.from(lanes.values())
  lanes.clear()
  await Promise.all(
    all.map((lane) => {
      clearIdleTimer(lane)
      return closeLaneClient(lane)
    })
  )
}
