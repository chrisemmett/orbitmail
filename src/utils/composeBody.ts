/**
 * Join what the user wrote with the quoted original for sending.
 *
 * The two travel separately while composing — the quote is a collapsible,
 * editable block below the body — and are only combined here, on send. That is
 * also why removing or trimming the quote needs no other change: whatever this
 * is given is what goes out.
 */
export function joinBodyWithQuote(
  bodyHtml: string,
  bodyText: string,
  quote: { html: string; text: string } | null
): { bodyHtml: string; bodyText: string } {
  if (!quote) return { bodyHtml, bodyText }
  // An emptied quote is the same as no quote: trimming every line out of it
  // should not leave a pair of <br>s and a blank gap on the recipient's screen.
  if (!quote.text.trim() && !/<img|<table/i.test(quote.html)) {
    return { bodyHtml, bodyText }
  }
  return {
    bodyHtml: `${bodyHtml}<br><br>${quote.html}`,
    bodyText: `${bodyText}\n\n${quote.text}`
  }
}
