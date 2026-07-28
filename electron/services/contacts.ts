// Collected addresses for compose autocomplete.
//
// There is no address book and no contacts UI: a row exists because the account
// corresponded with it. Every message the sync writes contributes its
// participants, and the polarity decides which counter moves — addresses on
// mail the user *sent* are people they chose to write to (sent_count), everyone
// else merely turned up in their mail (seen_count). Ranking leans on that
// distinction hard, so a stranger who mailed once can never outrank someone the
// user actually writes to.
//
// Contacts are scoped per account: composing from work suggests only what the
// work account has seen, so a personal contact cannot surface in a work mail.

import type Database from 'better-sqlite3'
import { getRawSqlite } from '../db'
import { extractAddress, extractName, splitAddressList } from '../../shared/addresses'

export interface ContactSuggestion {
  address: string
  name: string | null
  sentCount: number
  seenCount: number
}

interface Participant {
  address: string
  name: string | null
}

// One participant per distinct mailbox. `name` is null when the header carried
// no real display name — a bare address is not a name, and storing it as one
// would let it overwrite a good name learned from another message.
function participants(list: string | null | undefined): Participant[] {
  if (!list) return []
  const out: Participant[] = []
  const seen = new Set<string>()
  for (const raw of splitAddressList(list)) {
    const address = extractAddress(raw)
    // Reject anything that isn't a plausible mailbox: group syntax, an
    // undisclosed-recipients placeholder, or a mangled header would otherwise
    // become a permanent suggestion.
    if (!address.includes('@') || address.includes(' ') || seen.has(address)) continue
    seen.add(address)
    const display = extractName(raw).replace(/^["']|["']$/g, '').trim()
    out.push({
      address,
      name: display && display.toLowerCase() !== address ? display : null
    })
  }
  return out
}

const UPSERT_SQL = `
  INSERT INTO contacts (account_id, address, name, sent_count, seen_count, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_id, address) DO UPDATE SET
    name = COALESCE(excluded.name, contacts.name),
    sent_count = contacts.sent_count + excluded.sent_count,
    seen_count = contacts.seen_count + excluded.seen_count,
    last_seen_at = MAX(contacts.last_seen_at, excluded.last_seen_at)
`

// Harvest runs once per synced message, so the statement is compiled once per
// database rather than per message. Keyed on the connection: the test suite (and
// a DB reopen) swaps it, and a statement from the old one is dead.
let statementDb: Database.Database | null = null
let upsertStatement: Database.Statement | null = null

function contactUpsert(): Database.Statement {
  const sqlite = getRawSqlite()
  if (statementDb !== sqlite || !upsertStatement) {
    statementDb = sqlite
    upsertStatement = sqlite.prepare(UPSERT_SQL)
  }
  return upsertStatement
}

export interface HarvestSource {
  accountId: string
  /** The account's own address — decides whether this message is outgoing. */
  accountEmail: string
  from: string
  to: string
  cc?: string | null
  date: number
}

/**
 * Record one message's participants. Safe to call inside an existing
 * transaction; the caller's batch keeps this to one commit.
 *
 * Outgoing mail credits To/Cc as sent-to. Incoming mail credits the sender, and
 * also the other recipients — someone who cc's you alongside three colleagues
 * is a correspondent, and reply-all is exactly when autocomplete has to know
 * them — but only ever as `seen`.
 */
export function harvestContacts(source: HarvestSource): number {
  const upsert = contactUpsert()
  const self = source.accountEmail.trim().toLowerCase()
  const outgoing = extractAddress(source.from) === self

  const people = outgoing
    ? [...participants(source.to), ...participants(source.cc)]
    : [...participants(source.from), ...participants(source.to), ...participants(source.cc)]

  let written = 0
  for (const person of people) {
    // The user's own address is not a suggestion worth making to them.
    if (person.address === self) continue
    upsert.run(
      source.accountId,
      person.address,
      person.name,
      outgoing ? 1 : 0,
      outgoing ? 0 : 1,
      source.date
    )
    written++
  }
  return written
}

function likeEscape(text: string): string {
  return text.replace(/[\\_%]/g, '\\$&')
}

/**
 * Addresses matching `query` for one account, best first.
 *
 * Ranking, in order: people written to before anyone merely seen; then a match
 * at the *start* of the name or address before one buried in the middle (typing
 * "rob" should offer rob@ before rprobert@); then how often, then how recently.
 */
export function suggestContacts(
  accountId: string,
  query: string,
  limit = 8
): ContactSuggestion[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return []
  const escaped = likeEscape(trimmed)
  const contains = `%${escaped}%`
  const prefix = `${escaped}%`

  const sqlite = getRawSqlite()
  return sqlite
    .prepare(
      `SELECT address, name, sent_count AS sentCount, seen_count AS seenCount
         FROM contacts
        WHERE account_id = ?
          AND (address LIKE ? COLLATE NOCASE ESCAPE '\\'
               OR name LIKE ? COLLATE NOCASE ESCAPE '\\')
        ORDER BY
          CASE WHEN sent_count > 0 THEN 0 ELSE 1 END,
          CASE WHEN address LIKE ? COLLATE NOCASE ESCAPE '\\'
                 OR name LIKE ? COLLATE NOCASE ESCAPE '\\' THEN 0 ELSE 1 END,
          sent_count DESC,
          seen_count DESC,
          last_seen_at DESC,
          address ASC
        LIMIT ?`
    )
    .all(accountId, contains, contains, prefix, prefix, limit) as ContactSuggestion[]
}

// ---------------------------------------------------------------------------
// Backfill — mail already in the database when this feature arrived.
//
// New mail is harvested as it syncs, so this only ever drains the historical
// backlog. It walks messages by rowid and keeps its place in app_preferences,
// advancing the cursor in the same transaction as the writes: a batch either
// counts and is marked done, or neither. Killing the app mid-backfill resumes,
// it does not double-count.
// ---------------------------------------------------------------------------

const CURSOR_KEY = 'contacts_backfill_rowid'

function readCursor(): number {
  const sqlite = getRawSqlite()
  const row = sqlite
    .prepare('SELECT value FROM app_preferences WHERE key = ?')
    .get(CURSOR_KEY) as { value: string } | undefined
  const parsed = row ? Number.parseInt(row.value, 10) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Harvest one batch of already-synced messages. Returns rows processed; 0 when
 * the backlog is drained, so a caller can loop until it returns 0.
 */
export function backfillContactsBatch(batchSize = 500): number {
  const sqlite = getRawSqlite()
  const cursor = readCursor()

  const rows = sqlite
    .prepare(
      `SELECT m.rowid AS rowid, m.account_id AS accountId, m.from_addr AS fromAddr,
              m.to_addr AS toAddr, m.cc AS cc, m.date AS date, a.email AS accountEmail
         FROM messages m
         JOIN accounts a ON a.id = m.account_id
        WHERE m.rowid > ?
        ORDER BY m.rowid
        LIMIT ?`
    )
    .all(cursor, batchSize) as Array<{
    rowid: number
    accountId: string
    fromAddr: string
    toAddr: string
    cc: string | null
    date: number
    accountEmail: string
  }>
  if (rows.length === 0) return 0

  const setCursor = sqlite.prepare(
    `INSERT INTO app_preferences (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )

  const run = sqlite.transaction((batch: typeof rows) => {
    for (const row of batch) {
      harvestContacts({
        accountId: row.accountId,
        accountEmail: row.accountEmail,
        from: row.fromAddr,
        to: row.toAddr,
        cc: row.cc,
        date: row.date
      })
    }
    setCursor.run(CURSOR_KEY, String(batch[batch.length - 1].rowid))
  })
  run(rows)

  return rows.length
}
