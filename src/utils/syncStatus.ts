import type { SyncStatus, AccountSyncStatus } from '../../shared/types'

/**
 * What the status bar should say, derived from per-account sync status.
 *
 * Pure on purpose. The bug this replaces was one line of JSX — the last-synced
 * time was rendered only when `!syncStatus.error`, so a single failing mailbox
 * deleted the timestamp for every healthy one. That was invisible to every test
 * the repo has: `test:imap` is windowless and cannot mount a component, and
 * nothing else reached the renderer. Keeping the decision here as string and
 * number work means `test:store` can drive it under plain node.
 */
export interface SyncStatusSummary {
  /** Accounts reporting an error of their own, in map order. */
  failing: AccountSyncStatus[]
  /** One line for the bar. A single failure names itself; several are counted. */
  errorLabel: string | null
  /** Any failure that reads like an expired credential rather than a network blip. */
  needsReauth: boolean
  /**
   * Newest successful sync among accounts that are *not* failing, or null if
   * none has ever synced. A failing account never contributes its stale
   * timestamp here, and — the actual fix — never suppresses anyone else's.
   */
  healthyLastSyncAt: number | null
  /** True when some accounts are fine and others are not, which changes the wording. */
  mixed: boolean
}

const REAUTH_PATTERN = /auth|token|login|expired|invalid_grant|consent/i

export function summarizeSyncStatus(status: SyncStatus): SyncStatusSummary {
  const all = Object.values(status.accounts ?? {})
  const failing = all.filter((a) => a.error)
  const healthy = all.filter((a) => !a.error)

  const healthyLastSyncAt = healthy.reduce<number | null>(
    (newest, a) =>
      a.lastSyncAt !== null && (newest === null || a.lastSyncAt > newest)
        ? a.lastSyncAt
        : newest,
    null
  )

  return {
    failing,
    errorLabel:
      failing.length === 0
        ? null
        : failing.length === 1
          ? `${failing[0].email}: ${failing[0].error}`
          : `${failing.length} accounts are not syncing`,
    needsReauth: failing.some((a) => REAUTH_PATTERN.test(a.error ?? '')),
    healthyLastSyncAt,
    mixed: failing.length > 0 && healthy.length > 0
  }
}

/** The full per-account detail, for the summary line's tooltip. */
export function syncErrorDetail(failing: AccountSyncStatus[]): string {
  return failing.map((a) => `${a.email}: ${a.error}`).join('\n')
}
