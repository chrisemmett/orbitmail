/**
 * What kind of attachment this is, by MIME type and filename.
 *
 * Shared because both sides need the same answer and must not disagree. Main
 * uses it to decide what to extract; the renderer uses it to decide whether an
 * analysis that skipped attachments is worth mentioning — and if the two ever
 * drifted, the reader would offer to include a file the extractor cannot read,
 * or stay silent about one it can.
 *
 * Pure string logic, no I/O: the extraction that acts on these answers lives in
 * `electron/services/{office,rtf,eml}-text.ts`, which are main-only.
 *
 * Senders (and some IMAP servers) label attachments `application/octet-stream`,
 * so every check falls back to the extension when the MIME type does not settle
 * it.
 */

export type DocumentKind =
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'odf-text'
  | 'odf-sheet'
  | 'odf-presentation'

const DOCUMENT_MIME_TYPES: Record<string, DocumentKind> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
  'application/vnd.oasis.opendocument.text': 'odf-text',
  'application/vnd.oasis.opendocument.spreadsheet': 'odf-sheet',
  'application/vnd.oasis.opendocument.presentation': 'odf-presentation'
}

const DOCUMENT_EXTENSIONS: Array<[RegExp, DocumentKind]> = [
  [/\.docx$/i, 'word'],
  [/\.xlsx$/i, 'excel'],
  [/\.pptx$/i, 'powerpoint'],
  [/\.odt$/i, 'odf-text'],
  [/\.ods$/i, 'odf-sheet'],
  [/\.odp$/i, 'odf-presentation']
]

export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Which ZIP-based document flavour this is, or null if it isn't one. */
export function officeKind(mime: string, filename: string): DocumentKind | null {
  const byMime = DOCUMENT_MIME_TYPES[mime]
  if (byMime) return byMime
  for (const [pattern, kind] of DOCUMENT_EXTENSIONS) {
    if (pattern.test(filename)) return kind
  }
  return null
}

export function isRtf(mime: string, filename: string): boolean {
  if (mime === 'application/rtf' || mime === 'text/rtf' || mime === 'text/richtext') return true
  return /\.rtf$/i.test(filename)
}

/** An email in its own right — a forward sent as an attachment. */
export function isEmailAttachment(mime: string, filename: string): boolean {
  if (mime === 'message/rfc822') return true
  return /\.eml$/i.test(filename)
}

export function isPdfAttachment(mime: string, filename: string): boolean {
  return mime === 'application/pdf' || /\.pdf$/i.test(filename)
}

export function isImageAttachment(mime: string): boolean {
  return IMAGE_TYPES.has(mime)
}

/** Whether an attachment's text can be inlined as-is. */
export function isTextualAttachment(mime: string, filename: string): boolean {
  // RTF is `text/rtf` at some senders, but it is markup that needs decoding
  // rather than text to inline — it has its own branch.
  if (isRtf(mime, filename)) return false
  if (mime.startsWith('text/')) return true
  if (/^application\/(json|xml|x-yaml|yaml|csv|toml|sql)$/i.test(mime)) return true
  // Calendar invitations and contact cards are plain text and among the most
  // useful things a mail attachment can contain — an invite says when.
  if (/^text\/(calendar|vcard|x-vcard)$/i.test(mime)) return true
  return /\.(txt|md|markdown|csv|tsv|json|xml|log|ya?ml|html?|ics|vcf|ini|conf|cfg|toml|rst|sql|diff|patch)$/i.test(
    filename
  )
}

export function isHtmlAttachment(mime: string, filename: string): boolean {
  return mime === 'text/html' || /\.html?$/i.test(filename)
}

/**
 * Whether including this attachment would have added anything.
 *
 * This is what decides the reader's "not included" caveat, so it is
 * deliberately the *narrow* question — not "is there an attachment" but "is
 * there one we could actually have read". A `.doc` is excluded because we
 * cannot open it, so offering to include it would be a lie.
 *
 * **Images are excluded on purpose**, and it costs a little to do so: a
 * screenshot is worth reading, and this will not offer to. But an attachment
 * row carries no disposition, so a signature logo and a screenshot are the same
 * thing here — and on a real mailbox, 27% of messages with attachments have
 * nothing but small images. Prompting on those would make the caveat noise,
 * which is exactly what it was added to avoid. Silence on a screenshot is a
 * miss; a nag on every corporate footer is a broken feature.
 */
export function isReadableDocument(mime: string, filename: string): boolean {
  return (
    officeKind(mime, filename) !== null ||
    isRtf(mime, filename) ||
    isEmailAttachment(mime, filename) ||
    isPdfAttachment(mime, filename) ||
    isTextualAttachment(mime, filename)
  )
}
