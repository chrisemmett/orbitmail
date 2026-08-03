/**
 * Text out of an attached email (`message/rfc822`, `.eml`).
 *
 * A forwarded-as-attachment message is a normal thing to want summarised — it
 * is what "see below, what do you think?" arrives as, and it is what Orbit's own
 * **Forward as Attachment** sends. The extraction is small because `mailparser`
 * is already a dependency. What took deciding is everything around it, so the
 * three decisions are recorded here rather than in a commit message:
 *
 * **1. It does not recurse.** An attached message has its own attachments,
 * which may include another attached message. Following that is unbounded by
 * construction — depth is chosen by whoever sent the mail, not by us — and each
 * level multiplies the tokens a single analysis can cost. So: one level. The
 * nested message's own attachments are **named and not read**, which is the
 * same bargain the outer analysis already strikes with `skippedAttachments`:
 * say what was not looked at rather than let its absence pass for nothing.
 *
 * **2. Four headers, not the block.** From, To, Date, Subject — the ones that
 * say whose message this is and when. The rest is routing: `Received` chains
 * name intermediate hosts, `X-` headers carry whatever a provider felt like,
 * and none of it helps a summary while all of it costs tokens.
 *
 * **3. One fence, around the whole thing.** The caller wraps what this returns
 * in `fenceUntrusted` exactly as it wraps any other attachment. Fencing the
 * parts separately was the alternative and is worse: it would mean writing our
 * own labels *between* fenced regions from strings the sender controls, and a
 * `From:` line the sender chose is not more trustworthy than the body under it.
 * Everything here is one block of sender-written data, so it gets one fence —
 * and the header lines below are written by us, from parsed values, so they
 * cannot be forged into looking like our markers.
 */

import { readFile } from 'fs/promises'
import { simpleParser, type AddressObject } from 'mailparser'
import { stripHtml } from './html-text'

/** Attached messages this size are not parsed at all. */
const MAX_EML_BYTES = 4 * 1024 * 1024

/** Whether this attachment is an email in its own right. */
export function isEmailAttachment(mime: string, filename: string): boolean {
  if (mime === 'message/rfc822') return true
  return /\.eml$/i.test(filename)
}

/** `to`/`cc` arrive as an object, or an array of them, or nothing. */
function addressText(value: AddressObject | AddressObject[] | undefined): string {
  if (!value) return ''
  return (Array.isArray(value) ? value : [value])
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(', ')
}

/**
 * The readable content of an attached email, or null when there is none — the
 * caller's signal to report the attachment as skipped rather than send the
 * model a heading with nothing under it.
 */
export async function extractEmailText(path: string): Promise<string | null> {
  let raw: Buffer
  try {
    raw = await readFile(path)
  } catch {
    return null
  }
  if (raw.length > MAX_EML_BYTES) return null

  let parsed: Awaited<ReturnType<typeof simpleParser>>
  try {
    parsed = await simpleParser(raw)
  } catch {
    return null
  }

  const lines: string[] = []
  const header = (label: string, value: string): void => {
    // Newlines out of a header value would let it write extra lines of its own
    // into what reads as our label block.
    const clean = value.replace(/[\r\n]+/g, ' ').trim()
    if (clean) lines.push(`${label}: ${clean}`)
  }

  header('From', parsed.from?.text ?? '')
  header('To', addressText(parsed.to))
  header('Date', parsed.date ? parsed.date.toISOString() : '')
  header('Subject', parsed.subject ?? '')

  const body = parsed.text?.trim() || (parsed.html ? stripHtml(parsed.html) : '')
  if (body) {
    lines.push('')
    lines.push(body)
  }

  // Named, not read — see decision 1. Worth saying even though nothing is
  // extracted: an analysis that knows a document was attached can tell the user
  // it exists, which beats the message appearing to have arrived bare.
  const nested = parsed.attachments
    ?.map((a) => a.filename)
    .filter((name): name is string => Boolean(name))
  if (nested && nested.length > 0) {
    lines.push('')
    lines.push(`(This attached message carries its own attachments, not read: ${nested.join(', ')})`)
  }

  const text = lines.join('\n').trim()
  return text.length > 0 ? text : null
}
