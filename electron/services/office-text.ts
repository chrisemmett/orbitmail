/**
 * Text extraction for ZIP-based document attachments — OOXML (.docx / .xlsx /
 * .pptx) and OpenDocument (.odt / .ods / .odp).
 *
 * The Anthropic API does not accept any of these: a `document` content block
 * takes PDF or plain text only, and the Files API's supported-type table maps
 * everything else to the code-execution sandbox. So a .docx that reaches the
 * model has to arrive as text we extracted ourselves. Before this existed, an
 * "Include attachments" analysis of a meeting agenda silently sent the body
 * alone and produced a summary that told the user to read the attachment.
 *
 * Both families are ZIP containers of XML parts, so one unzip serves both and
 * the two differ only in which part to read and which elements hold text — no
 * dependency, nothing leaves the machine.
 *
 * Deliberately *not* handled, and left to the caller's skipped list: the legacy
 * OLE formats (.doc/.xls/.ppt, not ZIPs at all), encrypted documents (OLE
 * wrappers around the ciphertext), iWork (.pages/.numbers/.key — ZIPs, but the
 * payload is a binary protobuf variant, not XML), and ZIP64 archives. Images
 * inside a document are not extracted — only its text.
 */

import { readFileSync } from 'fs'
import { inflateRawSync } from 'zlib'

// Signatures, little-endian, from the ZIP spec (APPNOTE.TXT §4.3).
const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

// The end-of-central-directory record sits at the end of the file, followed
// only by an optional comment of at most 0xffff bytes.
const MAX_EOCD_SCAN = 0xffff + 22

// A pathological archive shouldn't be able to build an unbounded string. The
// caller truncates to its own model budget well below this; this is a backstop.
const MAX_EXTRACTED_CHARS = 200_000

// A repeated ODF cell can claim the rest of the row (`number-columns-repeated
// = "16384"` is how a spreadsheet says "and the remaining columns are empty").
// Expanding that literally turns one cell into a row of thousands, so repeats
// are honoured only up to here — enough for a real run of repeated values.
const MAX_ODF_CELL_REPEAT = 50

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

type DocumentKind =
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'odf-text'
  | 'odf-sheet'
  | 'odf-presentation'

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localHeaderOffset: number
}

/**
 * Which ZIP-based document flavour this attachment is, or null if it isn't
 * one. Senders (and some IMAP servers) label attachments
 * `application/octet-stream`, so the extension is consulted whenever the MIME
 * type doesn't settle it.
 */
export function officeKind(mime: string, filename: string): DocumentKind | null {
  const byMime = DOCUMENT_MIME_TYPES[mime]
  if (byMime) return byMime

  for (const [pattern, kind] of DOCUMENT_EXTENSIONS) {
    if (pattern.test(filename)) return kind
  }
  return null
}

/**
 * Read a ZIP-based document and return its text, or null if it can't be read
 * as one (not a ZIP, ZIP64, encrypted, missing the expected parts). A null
 * return is the caller's signal to report the attachment as skipped rather
 * than to fail the analysis.
 */
export function extractOfficeText(path: string, kind: DocumentKind): string | null {
  let buf: Buffer
  try {
    buf = readFileSync(path)
  } catch {
    return null
  }

  const entries = readCentralDirectory(buf)
  if (!entries) return null

  const byName = new Map(entries.map((e) => [e.name, e]))
  const read = (name: string): string | null => {
    const entry = byName.get(name)
    if (!entry) return null
    const raw = extractEntry(buf, entry)
    return raw ? raw.toString('utf8') : null
  }

  let text: string
  switch (kind) {
    case 'word':
      text = extractWord(read)
      break
    case 'excel':
      text = extractExcel(read, entries)
      break
    case 'powerpoint':
      text = extractPowerPoint(read, entries)
      break
    // Every ODF flavour keeps its content in one part; only the element that
    // frames a "row" or a "slide" differs.
    case 'odf-text':
      text = odfToText(read('content.xml') ?? '')
      break
    case 'odf-sheet':
      text = extractOdfSheet(read('content.xml') ?? '')
      break
    case 'odf-presentation':
      text = extractOdfPresentation(read('content.xml') ?? '')
      break
  }

  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

// ---------------------------------------------------------------------------
// Per-format extraction
// ---------------------------------------------------------------------------

function extractWord(read: (name: string) => string | null): string {
  // Body text only. Headers and footers (word/header*.xml) are page furniture —
  // a letterhead repeated on every page is noise in a summary, not content.
  const xml = read('word/document.xml')
  return xml ? xmlToText(xml) : ''
}

function extractExcel(read: (name: string) => string | null, entries: ZipEntry[]): string {
  // Cell values live in the sheets, but string values are indirected through a
  // shared-strings table, so a sheet alone reads as a list of integers.
  const shared = read('xl/sharedStrings.xml')
  const strings = shared ? parseSharedStrings(shared) : []

  const sheets = entries
    .map((e) => e.name)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort(numericPartOrder)

  const out: string[] = []
  for (const name of sheets) {
    const xml = read(name)
    if (!xml) continue
    const rows = parseSheetRows(xml, strings)
    if (rows.length === 0) continue
    if (sheets.length > 1) out.push(`[${name.replace(/^xl\/worksheets\//, '')}]`)
    out.push(...rows)
  }
  return out.join('\n')
}

function extractPowerPoint(read: (name: string) => string | null, entries: ZipEntry[]): string {
  const slides = entries
    .map((e) => e.name)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort(numericPartOrder)

  const out: string[] = []
  slides.forEach((name, index) => {
    const xml = read(name)
    if (!xml) return
    const text = xmlToText(xml)
    if (!text.trim()) return
    out.push(`[Slide ${index + 1}]`)
    out.push(text)
  })
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// OpenDocument
//
// Same principle as OOXML, different vocabulary. Text is read only from
// paragraph elements (`text:p`, `text:h`) rather than by stripping the whole
// part, so document settings, styles and drawing geometry — which are element
// text here too — stay out of the result.
// ---------------------------------------------------------------------------

// Self-closing first and separately, for the reason given in extractOdfSheet:
// `<text:p/>` is how ODF writes a blank line, and folding it into one
// alternation makes it swallow the paragraph that follows — the text survives,
// but the break between them does not. The empty branch captures nothing, so
// it yields the blank line it stands for.
const ODF_PARAGRAPHS = /<text:(?:p|h)\b[^>]*\/>|<text:(p|h)\b[^>]*>([\s\S]*?)<\/text:\1>/g

/** The text of one `text:p`/`text:h` body, with ODF's whitespace elements. */
function odfParagraphText(inner: string): string {
  const withWhitespace = inner
    .replace(/<text:tab\b[^>]*\/?>/g, '\t')
    .replace(/<text:line-break\b[^>]*\/?>/g, '\n')
    // Runs of spaces are collapsed by XML, so ODF encodes them explicitly:
    // <text:s/> is one space, text:c says how many.
    .replace(/<text:s\b[^>]*text:c="(\d+)"[^>]*\/?>/g, (_, n: string) =>
      ' '.repeat(Math.min(Number.parseInt(n, 10) || 1, 100))
    )
    .replace(/<text:s\b[^>]*\/?>/g, ' ')
  return decodeEntities(stripTags(withWhitespace))
}

/** Every paragraph in a fragment, one per line. */
function odfToText(xml: string): string {
  const lines: string[] = []
  let total = 0
  for (const match of xml.matchAll(ODF_PARAGRAPHS)) {
    const line = odfParagraphText(match[2] ?? '')
    total += line.length
    lines.push(line)
    if (total > MAX_EXTRACTED_CHARS) break
  }
  return lines
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, MAX_EXTRACTED_CHARS)
}

/** `.ods` — one tab-separated line per `table:table-row`, as for `.xlsx`. */
function extractOdfSheet(xml: string): string {
  const out: string[] = []
  const tables = xml.match(/<table:table\b[^>]*>[\s\S]*?<\/table:table>/g) ?? []

  for (const table of tables) {
    const name = /\btable:name="([^"]*)"/.exec(table)?.[1]
    const rows: string[] = []

    for (const row of table.match(/<table:table-row\b[^>]*>[\s\S]*?<\/table:table-row>/g) ?? []) {
      const cells: string[] = []
      for (const cell of row.match(
        // Self-closing form first, and as its own alternative rather than a
        // group inside one: `[^>]*(?:\/>|>…)` looks equivalent but is not —
        // `[^>]*` swallows the `/`, the `>` branch then matches, and the lazy
        // body runs on to the *next* cell's closing tag, merging two cells and
        // applying the empty one's repeat count to its neighbour's value.
        /<table:table-cell\b[^>]*\/>|<table:table-cell\b[^>]*>[\s\S]*?<\/table:table-cell>/g
      ) ?? []) {
        const text = Array.from(cell.matchAll(ODF_PARAGRAPHS))
          .map((m) => odfParagraphText(m[2] ?? ''))
          .join(' ')
        // A repeat on an *empty* cell is padding to the end of the row and is
        // dropped with the other trailing empties below; only real values are
        // worth reproducing.
        const repeat = text
          ? Math.min(
              Number.parseInt(/\btable:number-columns-repeated="(\d+)"/.exec(cell)?.[1] ?? '1', 10) || 1,
              MAX_ODF_CELL_REPEAT
            )
          : 1
        for (let i = 0; i < repeat; i++) cells.push(text)
      }
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
      if (cells.length > 0) rows.push(cells.join('\t'))
    }

    if (rows.length === 0) continue
    if (tables.length > 1 && name) out.push(`[${name}]`)
    out.push(...rows)
  }
  return out.join('\n')
}

/** `.odp` — `draw:page` is a slide; frames within it hold the text. */
function extractOdfPresentation(xml: string): string {
  const out: string[] = []
  const pages = xml.match(/<draw:page\b[^>]*>[\s\S]*?<\/draw:page>/g) ?? []
  pages.forEach((page, index) => {
    const text = odfToText(page)
    if (!text.trim()) return
    out.push(`[Slide ${index + 1}]`)
    out.push(text)
  })
  return out.join('\n')
}

/** `<si>` entries, in order — a sheet cell of type `s` indexes into this. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  for (const si of xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) ?? []) {
    // One <si> can hold several <t> runs when the cell has mixed formatting.
    const runs = si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []
    out.push(runs.map((r) => decodeEntities(stripTags(r))).join(''))
  }
  return out
}

/**
 * One line of tab-separated values per spreadsheet row. Row and column
 * structure is what makes a number mean anything — a bare bag of cell values
 * would let the model pair the wrong label with the wrong figure.
 */
function parseSheetRows(xml: string, strings: string[]): string[] {
  const rows: string[] = []
  for (const row of xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = []
    // Self-closing cells (`<c r="B2"/>`, an empty cell carrying only a style)
    // must be their own alternative — see the note in extractOdfSheet for what
    // the combined form does to the cell after them.
    for (const cell of row.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? []) {
      cells.push(cellValue(cell, strings))
    }
    // Trailing empties are styling artefacts, not data.
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
    if (cells.length > 0) rows.push(cells.join('\t'))
  }
  return rows
}

function cellValue(cell: string, strings: string[]): string {
  const type = /\bt="([^"]*)"/.exec(cell)?.[1]

  if (type === 'inlineStr') {
    const runs = cell.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []
    return runs.map((r) => decodeEntities(stripTags(r))).join('')
  }

  const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell)?.[1]
  if (value === undefined) return ''

  if (type === 's') {
    const index = Number.parseInt(value, 10)
    return Number.isFinite(index) ? (strings[index] ?? '') : ''
  }
  // Numbers, booleans and dates arrive as their raw stored value. Dates are
  // serial numbers here; the model sees them as such rather than as a date.
  return decodeEntities(value)
}

// ---------------------------------------------------------------------------
// XML → text
// ---------------------------------------------------------------------------

/**
 * Flatten WordprocessingML/DrawingML to readable text.
 *
 * Text is taken only from run elements (`w:t`, `a:t`), never by stripping tags
 * across the whole part. OOXML stores plenty of *numbers* as element text —
 * `<wp:posOffset>` for a floating image's coordinates, numbering and revision
 * ids — and a blanket strip prefixes the document with things like
 * "34817056216650". Matching runs also excludes field instructions
 * (`w:instrText`) and text deleted under tracked changes (`w:delText`) for
 * free, since neither is a run.
 *
 * Paragraph, row and cell boundaries become whitespace, so the result keeps
 * the line structure a reader — and the model — depends on.
 */
const RUN_TOKENS =
  /<(?:w|a):t\b[^>]*>([\s\S]*?)<\/(?:w|a):t>|<(?:w|a):(tab|br)\b[^>]*\/?>|<\/(w:p|a:p|w:tr|w:tc)>/g

function xmlToText(xml: string): string {
  let out = ''
  for (const match of xml.matchAll(RUN_TOKENS)) {
    if (out.length > MAX_EXTRACTED_CHARS) break
    const [, runText, inline, close] = match
    if (runText !== undefined) out += decodeEntities(runText)
    else if (inline === 'tab') out += '\t'
    else if (inline === 'br') out += '\n'
    else if (close === 'w:tc') out += '\t'
    else out += '\n' // end of paragraph or table row
  }

  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    // Collapse the runs of blank lines that empty paragraphs leave behind.
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, MAX_EXTRACTED_CHARS)
}

function stripTags(xml: string): string {
  return xml.replace(/<[^>]*>/g, '')
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match
    }
    switch (entity) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      case 'nbsp':
        return ' '
      default:
        return match
    }
  })
}

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return fallback
  }
}

/** slide2 before slide10 — lexicographic order would not. */
function numericPartOrder(a: string, b: string): number {
  const n = (s: string) => Number.parseInt(/(\d+)\.xml$/.exec(s)?.[1] ?? '0', 10)
  return n(a) - n(b)
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader
// ---------------------------------------------------------------------------

function readCentralDirectory(buf: Buffer): ZipEntry[] | null {
  const eocd = findEocd(buf)
  if (eocd < 0) return null

  const count = buf.readUInt16LE(eocd + 10)
  const dirOffset = buf.readUInt32LE(eocd + 16)
  // ZIP64 puts the real values in a separate record; sentinel means we can't
  // read this archive. Office writes ZIP64 only for very large documents.
  if (dirOffset === 0xffffffff || count === 0xffff) return null
  if (dirOffset >= buf.length) return null

  const entries: ZipEntry[] = []
  let at = dirOffset
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== SIG_CENTRAL) return null

    const method = buf.readUInt16LE(at + 10)
    const compressedSize = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const localHeaderOffset = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)

    if (compressedSize !== 0xffffffff && localHeaderOffset !== 0xffffffff) {
      entries.push({ name, method, compressedSize, localHeaderOffset })
    }
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function findEocd(buf: Buffer): number {
  const start = Math.max(0, buf.length - MAX_EOCD_SCAN)
  for (let at = buf.length - 22; at >= start; at--) {
    if (buf.readUInt32LE(at) === SIG_EOCD) return at
  }
  return -1
}

function extractEntry(buf: Buffer, entry: ZipEntry): Buffer | null {
  const at = entry.localHeaderOffset
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== SIG_LOCAL) return null

  // The local header's own name/extra lengths can differ from the central
  // directory's, so the data offset must be computed from the local header.
  const nameLen = buf.readUInt16LE(at + 26)
  const extraLen = buf.readUInt16LE(at + 28)
  const start = at + 30 + nameLen + extraLen
  const end = start + entry.compressedSize
  if (end > buf.length) return null

  const data = buf.subarray(start, end)
  try {
    if (entry.method === 0) return data
    if (entry.method === 8) return inflateRawSync(data)
  } catch {
    return null
  }
  // Anything else (bzip2, LZMA, or an encrypted entry) is not ours to read.
  return null
}
