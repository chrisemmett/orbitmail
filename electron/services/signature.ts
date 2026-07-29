import type { ComposePayload } from '../../shared/types'

/**
 * Append an account's signature to the editable body of a compose payload.
 *
 * **Appending to `bodyHtml` is what puts it above the quoted text.** The quote
 * travels separately in `quotedHtml` and the composer renders it below, so
 * anything in the body is already above it — there is no positioning logic here
 * and there should not be. On a reply the body is empty and the signature is all
 * it holds; on an AI draft it follows the drafted text.
 *
 * **Skipped when reopening a draft.** The signature was appended when that draft
 * was first composed and is part of its saved body; appending again on every
 * reopen would stack them, one copy per time the draft was opened.
 */
export function appendSignature(
  payload: Partial<ComposePayload>,
  signature: string
): Partial<ComposePayload> {
  if (payload.draftId) return payload
  if (!signature.trim()) return payload
  return { ...payload, bodyHtml: `${payload.bodyHtml ?? ''}<br><br>${signature}` }
}
