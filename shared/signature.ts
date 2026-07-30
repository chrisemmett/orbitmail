/**
 * The signature block's marker, shared because three places must agree on it:
 * main appends it (`services/signature.ts`), the composer finds it to swap it
 * when the From account changes, and the integration suite asserts both.
 *
 * A marker is what makes swapping possible at all. Without it the signature is
 * indistinguishable from anything else the user typed, so changing From could
 * only either leave a stale signature behind or guess at which trailing markup
 * to replace. Gmail solves it the same way (`class="gmail_signature"`).
 *
 * It travels in the sent message and in the saved draft, deliberately: a draft
 * reopened tomorrow must still be swappable, and a `class` on a `div` costs a
 * recipient nothing.
 */
export const SIGNATURE_CLASS = 'orbit-signature'

/**
 * The blank line between the body and the signature sits *outside* the block, and
 * that placement is load-bearing rather than cosmetic.
 *
 * Moving it inside looks tidier — one node owning the whole insertion, so add,
 * remove and replace are symmetric — and it is wrong. On a new message the body
 * is otherwise empty, so the block would be the editor's *first* child, and
 * focusing a contentEditable puts the caret inside its first child: the user
 * would type into their own signature, and the next From switch would replace the
 * block and take the message with it. With a `<br>` first, the caret lands before
 * it, outside the block. Gmail nests it the same way, for the same reason.
 *
 * The cost is that removing the block has to take the separator with it — see
 * `dropSeparatorBefore` in the composer — or switching From repeatedly grows a
 * stack of blank lines. Both failures were caught by `e2e-signature.suite.ts`,
 * one after the other, and it now asserts each.
 */
export const SIGNATURE_SEPARATOR = '<br><br>'

/** The block itself: what a swap replaces the contents of. */
export function signatureBlock(signature: string): string {
  return `<div class="${SIGNATURE_CLASS}">${signature}</div>`
}

/** The block plus its separator, as appended to a body. */
export function signatureAppendix(signature: string): string {
  return `${SIGNATURE_SEPARATOR}${signatureBlock(signature)}`
}
