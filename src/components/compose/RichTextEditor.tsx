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
}

const BTN = { size: 16, weight: 'bold' as const }

/**
 * Per-image ceiling for pasting into the body. Inline images ride inside the
 * message itself, so they are counted against the recipient's message size limit
 * (commonly 25MB total) and are held as a data: URI in the draft until sent —
 * a phone photo pasted without thinking would bloat both.
 */
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024

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
  onImageRejected
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    // initialHtml is not always ours: a mailto: link supplies the body, so this
    // is an untrusted-input sink in a window that carries the full preload.
    el.innerHTML = sanitizeEmailHtml(initialHtml) ?? ''
    setEmpty(el.innerText.trim().length === 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = () => {
    const el = editorRef.current
    if (!el) return
    const text = el.innerText
    setEmpty(text.trim().length === 0)
    onChange(el.innerHTML, text)
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
        <select
          className="rte-select"
          aria-label="Paragraph style"
          defaultValue="p"
          onMouseDown={saveSelection}
          onChange={(e) => {
            exec('formatBlock', `<${e.target.value}>`)
            e.currentTarget.value = 'p'
          }}
        >
          <option value="p">Normal</option>
          <option value="h1">Heading</option>
          <option value="h2">Subheading</option>
          <option value="h3">Small heading</option>
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
