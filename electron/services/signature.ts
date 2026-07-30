import type { ComposePayload } from '../../shared/types'
import { signatureAppendix } from '../../shared/signature'

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
 *
 * **Wrapped in `SIGNATURE_CLASS`** so the composer can find it again and replace
 * it when the From account changes. Unmarked, it is indistinguishable from
 * anything else in the body, and switching accounts could only leave the previous
 * account's signature in place.
 */
export function appendSignature(
  payload: Partial<ComposePayload>,
  signature: string
): Partial<ComposePayload> {
  if (payload.draftId) return payload
  if (!signature.trim()) return payload
  return { ...payload, bodyHtml: `${payload.bodyHtml ?? ''}${signatureAppendix(signature)}` }
}
