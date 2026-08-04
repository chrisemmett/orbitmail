import { useEffect, useRef, useState } from 'react'
import { sanitizeEmailHtml } from '../../utils/sanitizeEmailHtml'
import { TextB } from '@phosphor-icons/react/dist/ssr/TextB'
import { TextItalic } from '@phosphor-icons/react/dist/ssr/TextItalic'
import { TextUnderline } from '@phosphor-icons/react/dist/ssr/TextUnderline'
import { TextStrikethrough } from '@phosphor-icons/react/dist/ssr/TextStrikethrough'
import { ListBullets } from '@phosphor-icons/react/dist/ssr/ListBullets'
import { ListNumbers } from '@phosphor-icons/react/dist/ssr/ListNumbers'
import { LinkSimple } from '@phosphor-icons/react/dist/ssr/LinkSimple'
import { Quotes } from '@phosphor-icons/react/dist/ssr/Quotes'
import { Code } from '@phosphor-icons/react/dist/ssr/Code'
import { TextAlignLeft } from '@phosphor-icons/react/dist/ssr/TextAlignLeft'
import { TextAlignCenter } from '@phosphor-icons/react/dist/ssr/TextAlignCenter'
import { TextAlignRight } from '@phosphor-icons/react/dist/ssr/TextAlignRight'
import { Palette } from '@phosphor-icons/react/dist/ssr/Palette'
import { Eraser } from '@phosphor-icons/react/dist/ssr/Eraser'

interface RichTextEditorProps {
  /** Initial HTML, applied once on mount (the editor is otherwise uncontrolled). */
  initialHtml: string
  onChange: (html: string, text: string) => void
  placeholder?: string
  /** Told when an image was too large to inline, so the caller can say so. */
  onImageRejected?: (message: string) => void
  /**
   * Handed the editable element on mount, for the rare caller that has to edit
   * the content *around* the user — the composer swapping the signature block
   * when the From account changes. Remounting to do that (the `key` trick) would
   * discard everything typed so far, and re-rendering from state is not available
   * here: the DOM is the source of truth.
   */
  onElement?: (element: HTMLDivElement | null) => void
}

const BTN = { size: 16, weight: 'bold' as const }

/**
 * Per-image ceiling for pasting into the body. Inline images ride inside the
 * message itself, so they are counted against the recipient's message size limit
 * (commonly 25MB total) and are held as a data: URI in the draft until sent —
 * a phone photo pasted without thinking would bloat both.
 */
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Every option is a full fallback stack, not a single name: the recipient
 * renders this, and a face they do not have installed falls back to whatever
 * their client picks unless the message says otherwise. The list is confined to
 * the faces that ship with both Windows and macOS for the same reason — an
 * elegant choice nobody else has is just a lottery for how the message looks.
 */
const FONT_FAMILIES: ReadonlyArray<{ label: string; stack: string }> = [
  { label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' },
  { label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { label: 'Courier New', stack: '"Courier New", Courier, monospace' }
]

/** px rather than pt: the editor is a browser, and pt only means px × 4/3 here. */
const FONT_SIZES: ReadonlyArray<number> = [10, 12, 14, 16, 18, 24, 32]

/**
 * The marker size for the fontSize trick below. 7 is the top of HTML's legacy
 * scale and the value `execCommand` is asked for, so it is what the elements it
 * creates are tagged with.
 */
const SIZE_MARKER = '7'

/** Block styles the paragraph select offers, innermost-first when nested. */
const BLOCK_TAGS = ['h1', 'h2', 'h3', 'p']

/**
 * The first family in a computed `font-family` list, unquoted and folded for
 * comparison. `getComputedStyle` returns the whole stack, and it re-quotes as it
 * pleases — `"Times New Roman", Times, serif` here, `Times New Roman` there — so
 * comparing the stacks as strings does not work.
 */
function primaryFamily(fontFamily: string): string {
  return (fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase()
}

/** The stack whose face is in effect, or '' for anything not on the menu. */
function matchFamily(fontFamily: string): string {
  const primary = primaryFamily(fontFamily)
  return FONT_FAMILIES.find((font) => primaryFamily(font.stack) === primary)?.stack ?? ''
}

/**
 * The size in effect, or '' for anything not on the menu — a heading, or mail
 * written elsewhere at a size we do not offer. Saying nothing is the honest
 * answer there; the alternative is rounding to a neighbour and claiming a size
 * the text is not.
 */
function matchSize(fontSize: string): string {
  const px = Math.round(parseFloat(fontSize))
  return FONT_SIZES.includes(px) ? String(px) : ''
}

/** The nearest enclosing block style, stopping at the editor itself. */
function matchBlock(from: Element | null, editor: Element): string {
  let node: Element | null = from
  while (node && node !== editor) {
    const tag = node.tagName.toLowerCase()
    if (BLOCK_TAGS.includes(tag)) return tag
    node = node.parentElement
  }
  // Text typed straight into the editor with no wrapper is a paragraph in
  // everything but markup, and `formatBlock` treats it as one.
  return 'p'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// A contentEditable rich-text editor with an extended formatting toolbar. It is
// uncontrolled — the DOM is the source of truth — so React never re-writes the
// innerHTML while typing (which would reset the caret). Remount it (via `key`)
// to load fresh content.
export function RichTextEditor({
  initialHtml,
  onChange,
  placeholder,
  onImageRejected,
  onElement
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [empty, setEmpty] = useState(true)
  /** What the three style selects show — the formatting under the caret. */
  const [current, setCurrent] = useState({ block: 'p', family: '', size: '' })

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    // initialHtml is not always ours: a mailto: link supplies the body, so this
    // is an untrusted-input sink in a window that carries the full preload.
    el.innerHTML = sanitizeEmailHtml(initialHtml) ?? ''
    setEmpty(el.innerText.trim().length === 0)
    onElement?.(el)
    return () => onElement?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Point the style selects at whatever the caret is now in.
   *
   * Read from `getComputedStyle` rather than `queryCommandValue`, which cannot
   * answer for size: it speaks the legacy 1–7 scale and has no idea what the px
   * value is. The computed style also gets inheritance right for free — text
   * inside a `<span style="font-family:…">` reports that family whether or not
   * the caret sits on the span itself.
   *
   * For a selection that spans several styles this reports the *start* of the
   * range, which is what every mail client does and is at least predictable.
   */
  const syncFromSelection = () => {
    const el = editorRef.current
    if (!el) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    // The listener is on `document`, so it hears every caret move in the window
    // — the subject line, the quoted-text block, the other editor in Settings.
    // Anything outside this editor leaves the controls as they were.
    if (!el.contains(range.startContainer)) return

    // A range that starts on an *element* boundary — which is what selecting a
    // paragraph's contents produces — has that element as its container, not the
    // styled span inside it. Reading the container directly therefore reported
    // the paragraph's own font for text that was plainly not in it: select a
    // sentence you have just set to 24px Georgia and the toolbar said 14px and
    // no font. Descend to the node the range actually starts at.
    let node: Node = range.startContainer
    if (node.nodeType === Node.ELEMENT_NODE) {
      node = node.childNodes[range.startOffset] ?? node
    }
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    if (!element) return

    const style = window.getComputedStyle(element)
    const next = {
      block: matchBlock(element, el),
      family: matchFamily(style.fontFamily),
      size: matchSize(style.fontSize)
    }
    // `selectionchange` fires on every keystroke and every arrow key. Returning
    // the previous object when nothing changed keeps that from re-rendering the
    // toolbar a few hundred times a minute while someone types.
    setCurrent((prev) =>
      prev.block === next.block && prev.family === next.family && prev.size === next.size
        ? prev
        : next
    )
  }

  useEffect(() => {
    // `selectionchange` is a document event: there is no element-level version,
    // which is why the containment check above is load-bearing rather than tidy.
    document.addEventListener('selectionchange', syncFromSelection)
    return () => document.removeEventListener('selectionchange', syncFromSelection)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = () => {
    const el = editorRef.current
    if (!el) return
    const text = el.innerText
    setEmpty(text.trim().length === 0)
    onChange(el.innerHTML, text)
    // Applying a command does not always move the selection, so `selectionchange`
    // cannot be relied on to fire after one — without this, setting a font left
    // the select still showing what was there before it was applied.
    syncFromSelection()
  }

  const focusEditor = () => editorRef.current?.focus()

  /**
   * Pasted and dropped images become inline `<img>` elements carrying the bytes
   * as a data: URI. They stay that way while editing — which means autosave
   * persists them with the draft for free — and are converted to `cid:` MIME
   * parts when the message is sent. Sending them as data: URIs instead would be
   * simpler and wrong: Gmail and Outlook strip data: images from received HTML,
   * so the recipient sees nothing.
   */
  const insertImageFiles = async (files: File[]): Promise<void> => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (images.length === 0) return

    for (const file of images) {
      if (file.size > MAX_INLINE_IMAGE_BYTES) {
        onImageRejected?.(
          `${file.name || 'That image'} is too large to place in the message — attach it instead.`
        )
        continue
      }
      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      })
      if (!dataUrl) continue
      // No restoreSelection here: that reinstates the range saved for a toolbar
      // click, and on paste or drop the caret is already where it should be.
      focusEditor()
      // Width-capped so a photo straight off a phone does not arrive as a
      // multi-thousand-pixel block the recipient has to scroll sideways past.
      document.execCommand(
        'insertHTML',
        false,
        `<img src="${dataUrl}" alt="${escapeHtml(file.name || 'image')}" style="max-width:100%;height:auto;">`
      )
    }
    emit()
  }

  const exec = (command: string, value?: string) => {
    focusEditor()
    document.execCommand(command, false, value)
    emit()
  }

  const saveSelection = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }

  const restoreSelection = () => {
    const range = savedRange.current
    if (!range) return
    focusEditor()
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  const applyLink = () => {
    const url = linkUrl.trim()
    setLinkOpen(false)
    setLinkUrl('')
    if (!url) return
    const href = /^https?:\/\/|^mailto:/i.test(url) ? url : `https://${url}`
    restoreSelection()
    document.execCommand('createLink', false, href)
    emit()
  }

  /**
   * `fontName` emits `<font face="…">` unless styleWithCSS is on, and a `<font>`
   * tag is the thing every guide to writing HTML mail tells you not to send.
   *
   * The flag is document-wide and sticky, so it goes on for this one command and
   * straight back off: left on, **bold would stop producing `<b>`** and start
   * producing `<span style="font-weight:bold">`, which is worse in exactly the
   * old clients this is trying to accommodate.
   */
  const applyFontFamily = (stack: string) => {
    restoreSelection()
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand('fontName', false, stack)
    document.execCommand('styleWithCSS', false, 'false')
    emit()
  }

  /**
   * `fontSize` speaks only HTML's legacy 1–7 scale, and even with styleWithCSS
   * on it yields keyword sizes (`large`, `x-large`) rather than the size asked
   * for — so neither mode can express "18px" on its own.
   *
   * Size 7 is therefore used as a **marker**: `execCommand` does the part worth
   * keeping, which is splitting the selection correctly across element
   * boundaries and partially-selected nodes, and the elements it just tagged are
   * then rewritten to carry the real size. Pasted mail can legitimately contain
   * `<font size="7">` of its own, and resizing text the user never selected
   * would be a silent corruption of their message, so the ones already present
   * are recorded first and left alone.
   */
  const applyFontSize = (px: number) => {
    const el = editorRef.current
    if (!el) return
    restoreSelection()
    const preexisting = new Set(el.querySelectorAll(`font[size="${SIZE_MARKER}"]`))
    document.execCommand('fontSize', false, SIZE_MARKER)

    const created: HTMLSpanElement[] = []
    for (const node of Array.from(el.querySelectorAll(`font[size="${SIZE_MARKER}"]`))) {
      if (preexisting.has(node)) continue
      const span = document.createElement('span')
      span.style.fontSize = `${px}px`
      // Moved rather than re-parsed through innerHTML: an inline image or a link
      // inside the selection has to survive as the same node, and round-tripping
      // it through a string is both lossy and a needless HTML-injection sink.
      while (node.firstChild) span.appendChild(node.firstChild)
      node.replaceWith(span)
      created.push(span)
    }

    // Replacing the nodes collapses the selection, which would mean reselecting
    // the same words to also set a font. Put it back across what was rewritten.
    if (created.length > 0) {
      const range = document.createRange()
      range.setStartBefore(created[0])
      range.setEndAfter(created[created.length - 1])
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      savedRange.current = range.cloneRange()
    }
    emit()
  }

  const insertCode = () => {
    focusEditor()
    const selected = window.getSelection()?.toString() ?? ''
    const escaped = selected.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    document.execCommand('insertHTML', false, `<code>${escaped || '​'}</code>`)
    emit()
  }

  const clearFormatting = () => {
    focusEditor()
    document.execCommand('removeFormat')
    document.execCommand('formatBlock', false, '<p>')
    emit()
  }

  // Keep toolbar clicks from stealing focus / collapsing the selection.
  const hold = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className="rte">
      <div className="rte-toolbar" role="toolbar" aria-label="Formatting">
        {/*
          All three are controlled by `current`, so they report the formatting
          under the caret rather than labelling themselves. The empty option each
          of the last two carries is what shows when the caret is somewhere the
          menu cannot describe — a heading, or mail composed elsewhere in a face
          we do not offer. It is deliberately not `disabled`: a disabled option
          is unselectable, so a value that lands on it would leave the control
          showing the previous font, which is the specific lie this avoids.
        */}
        <select
          className="rte-select"
          aria-label="Paragraph style"
          value={current.block}
          onMouseDown={saveSelection}
          onChange={(e) => exec('formatBlock', `<${e.target.value}>`)}
        >
          <option value="p">Normal</option>
          <option value="h1">Heading</option>
          <option value="h2">Subheading</option>
          <option value="h3">Small heading</option>
        </select>

        <select
          className="rte-select"
          aria-label="Font"
          value={current.family}
          onMouseDown={saveSelection}
          // Choosing the empty option back means "no change", not "no font".
          onChange={(e) => e.target.value && applyFontFamily(e.target.value)}
        >
          <option value="">Font</option>
          {FONT_FAMILIES.map((font) => (
            <option key={font.label} value={font.stack} style={{ fontFamily: font.stack }}>
              {font.label}
            </option>
          ))}
        </select>

        <select
          className="rte-select"
          aria-label="Font size"
          value={current.size}
          onMouseDown={saveSelection}
          onChange={(e) => e.target.value && applyFontSize(Number(e.target.value))}
        >
          <option value="">Size</option>
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>

        <span className="rte-sep" />

        <button type="button" className="rte-btn" title="Bold (Ctrl+B)" onMouseDown={hold} onClick={() => exec('bold')}>
          <TextB {...BTN} />
        </button>
        <button type="button" className="rte-btn" title="Italic (Ctrl+I)" onMouseDown={hold} onClick={() => exec('italic')}>
          <TextItalic {...BTN} />
        </button>
        <button type="button" className="rte-btn" title="Underline (Ctrl+U)" onMouseDown={hold} onClick={() => exec('underline')}>
          <TextUnderline {...BTN} />
        </button>
        <button type="button" className="rte-btn" title="Strikethrough" onMouseDown={hold} onClick={() => exec('strikeThrough')}>
          <TextStrikethrough {...BTN} />
        </button>

        <span className="rte-sep" />

        <button type="button" className="rte-btn" title="Align left" onMouseDown={hold} onClick={() => exec('justifyLeft')}>
          <TextAlignLeft {...BTN} />
        </button>
        <button type="button" className="rte-btn" title="Align center" onMouseDown={hold} onClick={() => exec('justifyCenter')}>
          <TextAlignCenter {...BTN} />
        </button>
        <button type="button" className="rte-btn" title="Align right" onMouseDown={hold} onClick={() => exec('justifyRight')}>
          <TextAlignRight {...BTN} />
        </button>

        <span className="rte-sep" />

        <button
          type="button"
          className="rte-btn"
          title="Text colour"
          onMouseDown={(e) => {
            hold(e)
            saveSelection()
          }}
          onClick={() => colorInputRef.current?.click()}
        >
          <Palette {...BTN} />
        </button>
        <input
          ref={colorInputRef}
          type="color"
          className="rte-color-input"
          aria-label="Text colour"
          onChange={(e) => {
            restoreSelection()
            document.execCommand('foreColor', false, e.target.value)
            emit()
          }}
        />

        <button type="button" className="rte-btn" title="Bulleted list" onMouseDown={hold} onClick={() => exec('insertUnorderedList')}>
          <ListBullets {...BTN} />
        </button>
        <button type="button" className="rte-btn" title="Numbered list" onMouseDown={hold} onClick={() => exec('insertOrderedList')}>
          <ListNumbers {...BTN} />
        </button>

        <span className="rte-sep" />

        <button
          type="button"
          className={`rte-btn${linkOpen ? ' is-active' : ''}`}
          title="Insert link"
          onMouseDown={(e) => {
            hold(e)
            saveSelection()
          }}
          onClick={() => setLinkOpen((o) => !o)}
        >
          <LinkSimple {...BTN} />
        </button>
        <button type="button" className="rte-btn" title="Quote" onMouseDown={hold} onClick={() => exec('formatBlock', '<blockquote>')}>
          <Quotes {...BTN} />
        </button>
        <button type="button" className="rte-btn" title="Inline code" onMouseDown={hold} onClick={insertCode}>
          <Code {...BTN} />
        </button>
        <button type="button" className="rte-btn" title="Clear formatting" onMouseDown={hold} onClick={clearFormatting}>
          <Eraser {...BTN} />
        </button>
      </div>

      {linkOpen && (
        <div className="rte-link-popover">
          <input
            className="rte-link-input"
            type="text"
            placeholder="https://example.com"
            value={linkUrl}
            autoFocus
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink()
              } else if (e.key === 'Escape') {
                setLinkOpen(false)
                setLinkUrl('')
              }
            }}
          />
          <button type="button" className="btn btn-secondary rte-link-apply" onMouseDown={hold} onClick={applyLink}>
            Add
          </button>
        </div>
      )}

      <div
        ref={editorRef}
        className="rte-editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-empty={empty}
        data-placeholder={placeholder ?? 'Write your message…'}
        onInput={emit}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData?.files ?? [])
          if (files.some((f) => f.type.startsWith('image/'))) {
            // Only intercept an image paste. Pasting text must keep the
            // browser's own handling, which carries formatting across.
            event.preventDefault()
            void insertImageFiles(files)
          }
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer?.items ?? []).some((i) => i.kind === 'file')) {
            // Claim the drop before the compose window's own attachment
            // handler sees it — a file dropped *into the body* is meant to be
            // in the body, not on the paperclip.
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer?.files ?? [])
          if (files.some((f) => f.type.startsWith('image/'))) {
            event.preventDefault()
            event.stopPropagation()
            void insertImageFiles(files)
          }
        }}
        suppressContentEditableWarning
      />
    </div>
  )
}
