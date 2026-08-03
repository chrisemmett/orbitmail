/**
 * Text extraction for OOXML attachments (.docx / .xlsx / .pptx).
 *
 * The Anthropic API does not accept Office formats: a `document` content block
 * takes PDF or plain text only, and the Files API's supported-type table maps
 * everything else to the code-execution sandbox. So a .docx that reaches the
 * model has to arrive as text we extracted ourselves. Before this existed, an
 * "Include attachments" analysis of a meeting agenda silently sent the body
 * alone and produced a summary that told the user to read the attachment.
 *
 * OOXML files are ZIP containers of XML parts, so this is an unzip plus a tag
 * strip — no dependency, nothing leaves the machine. Deliberately *not*
 * handled, and left to the caller's skipped list: the legacy OLE formats
 * (.doc/.xls/.ppt, not ZIPs at all), OpenDocument (.odt/.ods/.odp), encrypted
 * documents (which are OLE wrappers around the ciphertext), and ZIP64
 * archives. Images inside a document are not extracted — only its text.
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

const OOXML_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])

type OfficeKind = 'word' | 'excel' | 'powerpoint'

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localHeaderOffset: number
}

/**
 * Which OOXML flavour this attachment is, or null if it isn't one. Senders
 * (and some IMAP servers) label attachments `application/octet-stream`, so the
 * extension is consulted whenever the MIME type doesn't settle it.
 */
export function officeKind(mime: string, filename: string): OfficeKind | null {
  const byMime = OOXML_MIME_TYPES.has(mime)
    ? mime.endsWith('.document')
      ? 'word'
      : mime.endsWith('.sheet')
        ? 'excel'
        : 'powerpoint'
    : null
  if (byMime) return byMime

  if (/\.docx$/i.test(filename)) return 'word'
  if (/\.xlsx$/i.test(filename)) return 'excel'
  if (/\.pptx$/i.test(filename)) return 'powerpoint'
  return null
}

/**
 * Read an OOXML file and return its text, or null if it can't be read as one
 * (not a ZIP, ZIP64, encrypted, missing the expected parts). A null return is
 * the caller's signal to report the attachment as skipped rather than to fail
 * the analysis.
 */
export function extractOfficeText(path: string, kind: OfficeKind): string | null {
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
    for (const cell of row.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
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
