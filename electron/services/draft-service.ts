// Locally-saved compose drafts.
//
// Everything here is local. Drafts are never uploaded to the account's IMAP
// Drafts folder, so they behave identically for IMAP, POP3, Gmail and O365 and
// cannot fail because a mailbox is unreachable — at the cost of not appearing on
// another device. See TODO.md if that trade is ever revisited.

import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import type { ComposePayload, DraftSummary } from '../../shared/types'
import { getRawSqlite } from '../db'

interface DraftRow {
  id: string
  account_id: string
  to_addr: string
  cc: string
  bcc: string
  subject: string
  body_html: string
  body_text: string
  quoted_html: string | null
  quoted_text: string | null
  in_reply_to: string | null
  references: string | null
  mode: string | null
  original_message_id: string | null
  attachment_paths: string | null
  updated_at: number
}

function parsePaths(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

/**
 * Whether a draft is worth keeping. A composer opened and abandoned with nothing
 * typed would otherwise leave a blank row in the Drafts folder every time.
 *
 * The quoted block does not count: a reply that has been opened and not written
 * is exactly the empty case, and it always carries the quote.
 */
export function draftHasContent(payload: Partial<ComposePayload>): boolean {
  return !!(
    payload.to?.trim() ||
    payload.cc?.trim() ||
    payload.bcc?.trim() ||
    payload.subject?.trim() ||
    payload.bodyText?.trim() ||
    payload.attachmentPaths?.length
  )
}

/**
 * Create or update a draft, returning its id.
 *
 * **This replaces the row, it does not merge into it.** The composer always
 * sends its whole state, so a field omitted here means the user cleared it —
 * merging would make an emptied Cc impossible to save. The consequence is that
 * a caller passing a partial payload silently drops the rest, threading headers
 * included, so don't.
 *
 * An empty draft is not stored, and an existing draft that has been emptied is
 * deleted — so clearing a composer removes its row rather than leaving a blank
 * one behind. Returns null in that case.
 */
export function saveDraft(payload: Partial<ComposePayload>, draftId?: string): string | null {
  const sqlite = getRawSqlite()
  if (!payload.accountId) return null

  if (!draftHasContent(payload)) {
    if (draftId) sqlite.prepare('DELETE FROM drafts WHERE id = ?').run(draftId)
    return null
  }

  const id = draftId ?? randomUUID()
  sqlite
    .prepare(
      `INSERT INTO drafts (
         id, account_id, to_addr, cc, bcc, subject, body_html, body_text,
         quoted_html, quoted_text, in_reply_to, "references", mode,
         original_message_id, attachment_paths, updated_at
       ) VALUES (
         @id, @accountId, @to, @cc, @bcc, @subject, @bodyHtml, @bodyText,
         @quotedHtml, @quotedText, @inReplyTo, @references, @mode,
         @originalMessageId, @attachmentPaths, @updatedAt
       )
       ON CONFLICT(id) DO UPDATE SET
         account_id = excluded.account_id,
         to_addr = excluded.to_addr,
         cc = excluded.cc,
         bcc = excluded.bcc,
         subject = excluded.subject,
         body_html = excluded.body_html,
         body_text = excluded.body_text,
         quoted_html = excluded.quoted_html,
         quoted_text = excluded.quoted_text,
         in_reply_to = excluded.in_reply_to,
         "references" = excluded."references",
         mode = excluded.mode,
         original_message_id = excluded.original_message_id,
         attachment_paths = excluded.attachment_paths,
         updated_at = excluded.updated_at`
    )
    .run({
      id,
      accountId: payload.accountId,
      to: payload.to ?? '',
      cc: payload.cc ?? '',
      bcc: payload.bcc ?? '',
      subject: payload.subject ?? '',
      bodyHtml: payload.bodyHtml ?? '',
      bodyText: payload.bodyText ?? '',
      quotedHtml: payload.quotedHtml ?? null,
      quotedText: payload.quotedText ?? null,
      inReplyTo: payload.inReplyTo ?? null,
      references: payload.references ?? null,
      mode: payload.mode ?? null,
      originalMessageId: payload.originalMessageId ?? null,
      attachmentPaths: payload.attachmentPaths?.length
        ? JSON.stringify(payload.attachmentPaths)
        : null,
      updatedAt: Date.now()
    })
  return id
}

export function deleteDraft(draftId: string): void {
  getRawSqlite().prepare('DELETE FROM drafts WHERE id = ?').run(draftId)
}

/** Every draft for an account, newest first — what the Drafts folder lists. */
export function listDrafts(accountId: string): DraftSummary[] {
  const rows = getRawSqlite()
    .prepare('SELECT * FROM drafts WHERE account_id = ? ORDER BY updated_at DESC')
    .all(accountId) as DraftRow[]
  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    to: row.to_addr,
    subject: row.subject,
    // The list shows a snippet; the body is HTML-free text already.
    snippet: row.body_text.replace(/\s+/g, ' ').trim().slice(0, 200),
    updatedAt: row.updated_at,
    hasAttachments: parsePaths(row.attachment_paths).length > 0
  }))
}

/**
 * A draft as a compose payload, ready to reopen.
 *
 * Attachment paths that no longer exist are dropped and named back to the
 * caller: a draft saved weeks ago may reference a file since moved or deleted,
 * and silently sending without it is the failure this whole feature exists to
 * avoid. The surviving paths still need approving by main before a send will
 * accept them — the allowlist is per-session and this draft may predate a
 * restart.
 */
export function getDraftPayload(
  draftId: string
): { payload: Partial<ComposePayload>; missingAttachments: string[] } | null {
  const row = getRawSqlite().prepare('SELECT * FROM drafts WHERE id = ?').get(draftId) as
    | DraftRow
    | undefined
  if (!row) return null

  const stored = parsePaths(row.attachment_paths)
  const attachmentPaths = stored.filter((path) => existsSync(path))
  const missingAttachments = stored.filter((path) => !existsSync(path))

  return {
    payload: {
      accountId: row.account_id,
      to: row.to_addr,
      cc: row.cc,
      bcc: row.bcc,
      subject: row.subject,
      bodyHtml: row.body_html,
      bodyText: row.body_text,
      quotedHtml: row.quoted_html ?? undefined,
      quotedText: row.quoted_text ?? undefined,
      inReplyTo: row.in_reply_to ?? undefined,
      references: row.references ?? undefined,
      mode: (row.mode as ComposePayload['mode']) ?? undefined,
      originalMessageId: row.original_message_id ?? undefined,
      attachmentPaths: attachmentPaths.length ? attachmentPaths : undefined,
      draftId: row.id
    },
    missingAttachments
  }
}

/** How many drafts an account has — the Drafts folder's row count. */
export function countDrafts(accountId: string): number {
  const row = getRawSqlite()
    .prepare('SELECT COUNT(*) AS n FROM drafts WHERE account_id = ?')
    .get(accountId) as { n: number }
  return row.n
}
