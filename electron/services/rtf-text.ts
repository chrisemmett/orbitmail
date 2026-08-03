/**
 * Text extraction for RTF attachments.
 *
 * Worth having because Outlook and WordPad still emit `.rtf`, and like the
 * Office formats it is not something the API will take — a `document` block
 * accepts PDF or plain text only, so an unconverted `.rtf` is an attachment the
 * model never sees (see `office-text.ts` for the same argument at length).
 *
 * RTF is plain ASCII with markup, so this is a scanner rather than an unzip:
 * walk the string once, drop control words, and keep the literal text between
 * them. The parts that matter are the ones that are *not* text — a font table
 * or an embedded image renders as thousands of hex digits if you strip control
 * words naively, which is the same trap as OOXML's element-text numbers.
 *
 * Not handled: embedded objects and images (skipped, by design — only their
 * text would be useful and they carry none), and `\bin` binary runs, which end
 * the extraction rather than risk emitting binary as text.
 */

// Destinations whose content is markup, not document text. `\*` marks any
// destination the reader is allowed to ignore wholesale; these are the named
// ones that appear without it.
const SKIPPED_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'listtable',
  'listoverridetable',
  'revtbl',
  'rsidtbl',
  'generator',
  'info',
  'pict',
  'object',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf'
])

// Control words that produce whitespace rather than being dropped.
const BREAKS: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n',
  page: '\n',
  tab: '\t',
  cell: '\t',
  row: '\n',
  nestcell: '\t',
  nestrow: '\n'
}

const MAX_EXTRACTED_CHARS = 200_000

/** Whether this attachment looks like RTF, by MIME type or extension. */
export function isRtf(mime: string, filename: string): boolean {
  if (mime === 'application/rtf' || mime === 'text/rtf' || mime === 'text/richtext') return true
  return /\.rtf$/i.test(filename)
}

/**
 * Extract the readable text of an RTF document, or null if it isn't RTF or
 * carries no text — null is the caller's signal to report the attachment as
 * skipped.
 */
export function extractRtfText(rtf: string): string | null {
  if (!rtf.startsWith('{\\rtf')) return null

  let out = ''
  // Depth of the group nesting, and the depth at which we started skipping a
  // destination (null when not skipping). Skipping ends when that group closes.
  let depth = 0
  let skipFrom: number | null = null
  // \ucN says how many characters follow a \uN that are its pre-Unicode
  // substitute and must be swallowed. It is scoped to the current group.
  let unicodeSkip = 1
  const ucStack: number[] = []
  let pendingSkip = 0

  for (let i = 0; i < rtf.length && out.length < MAX_EXTRACTED_CHARS; i++) {
    const ch = rtf[i]

    if (ch === '{') {
      depth++
      ucStack.push(unicodeSkip)
      continue
    }

    if (ch === '}') {
      depth--
      unicodeSkip = ucStack.pop() ?? 1
      if (skipFrom !== null && depth < skipFrom) skipFrom = null
      continue
    }

    if (ch === '\\') {
      const next = rtf[i + 1]

      // Escaped literals.
      if (next === '\\' || next === '{' || next === '}') {
        if (skipFrom === null) out += next
        i++
        continue
      }

      // \'hh — one byte, written as hex. Treated as Latin-1: RTF's real
      // encoding is per-font and we do not track font tables, and Latin-1 at
      // least renders the accented characters of Western European mail.
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4)
        i += 3
        if (skipFrom === null) {
          if (pendingSkip > 0) pendingSkip--
          else {
            const code = Number.parseInt(hex, 16)
            if (Number.isFinite(code)) out += String.fromCharCode(code)
          }
        }
        continue
      }

      // A control word: letters, then an optional signed number, then an
      // optional single space that belongs to the word rather than the text.
      const word = /^([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(i + 1))
      if (!word) {
        // A lone \* introduces a destination the reader may ignore entirely.
        if (next === '*' && skipFrom === null) skipFrom = depth
        i++
        continue
      }

      const [matched, name, digits] = word
      i += matched.length

      if (name === 'bin') {
        // A binary run follows, whose length is the parameter. Nothing after it
        // can be trusted to be text, so stop rather than emit bytes.
        break
      }
      if (name === 'uc') {
        unicodeSkip = Number.parseInt(digits ?? '1', 10) || 0
        continue
      }
      if (name === 'u') {
        const code = Number.parseInt(digits ?? '', 10)
        if (skipFrom === null && Number.isFinite(code)) {
          // Negative values are the signed-16-bit spelling of a high code point.
          out += String.fromCharCode(code < 0 ? code + 0x10000 : code)
        }
        pendingSkip = unicodeSkip
        continue
      }
      if (SKIPPED_DESTINATIONS.has(name)) {
        if (skipFrom === null) skipFrom = depth
        continue
      }
      if (skipFrom === null && BREAKS[name] !== undefined) {
        out += BREAKS[name]
      }
      continue
    }

    if (skipFrom !== null) continue
    // Real line endings in the file are formatting, not content.
    if (ch === '\n' || ch === '\r') continue
    if (pendingSkip > 0) {
      pendingSkip--
      continue
    }
    out += ch
  }

  const text = out
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS)
  return text.length > 0 ? text : null
}
