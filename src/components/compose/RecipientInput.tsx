import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContactSuggestion } from '../../../shared/types'

// The field stays free text — a comma-separated address list, exactly what the
// send path already expects. Autocomplete only ever rewrites the address being
// typed (the token after the last comma) and leaves the rest of the line alone,
// so a half-finished list can never be mangled by a stray suggestion.

const MAX_SUGGESTIONS = 6

interface TokenSpan {
  start: number
  end: number
  text: string
}

// The address the caret is inside. Commas separate addresses; a display name in
// quotes may legitimately contain one ("Smith, John" <j@x>), so a comma inside
// quotes does not split.
export function activeToken(value: string, caret: number): TokenSpan {
  let start = 0
  let inQuotes = false
  for (let i = 0; i < caret; i++) {
    const ch = value[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ',' && !inQuotes) start = i + 1
  }
  let end = value.length
  inQuotes = false
  for (let i = start; i < value.length; i++) {
    const ch = value[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ',' && !inQuotes) {
      end = i
      break
    }
  }
  return { start, end, text: value.slice(start, end).trim() }
}

// Replace the token under the caret with a chosen address, keeping the rest of
// the list intact and leaving the caret ready for the next one.
export function applySuggestion(
  value: string,
  caret: number,
  suggestion: ContactSuggestion
): { value: string; caret: number } {
  const token = activeToken(value, caret)
  // A display name containing a comma has to be quoted or the address list
  // splits in the middle of somebody's name on the way out.
  const name = suggestion.name?.includes(',') ? `"${suggestion.name}"` : suggestion.name
  const formatted = name ? `${name} <${suggestion.address}>` : suggestion.address
  const before = value.slice(0, token.start)
  const after = value.slice(token.end)
  const lead = before.length > 0 && !before.endsWith(' ') ? ' ' : ''
  const head = `${before}${lead}${formatted}`
  // Land on ", " so the next address can be typed immediately, unless the list
  // already continues past this token.
  const tail = after.trim().length > 0 ? after : ', '
  return { value: `${head}${tail}`, caret: head.length + (after.trim().length > 0 ? 0 : 2) }
}

interface Props {
  value: string
  accountId: string
  placeholder?: string
  ariaLabel: string
  onChange: (value: string) => void
}

export function RecipientInput({ value, accountId, placeholder, ariaLabel, onChange }: Props) {
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([])
  const [highlight, setHighlight] = useState(0)
  const [open, setOpen] = useState(false)
  const [caret, setCaret] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Bumped on every accepted suggestion / dismissal so an in-flight lookup that
  // resolves afterwards cannot reopen the list behind the user.
  const requestSeq = useRef(0)

  const query = useMemo(() => activeToken(value, caret).text, [value, caret])

  useEffect(() => {
    // Once an address is complete there is nothing useful left to suggest.
    if (!open || query.length < 2 || query.includes('<')) {
      setSuggestions([])
      return
    }
    const seq = ++requestSeq.current
    let cancelled = false
    const timer = setTimeout(() => {
      window.orbitMail.contacts
        .suggest(accountId, query, MAX_SUGGESTIONS)
        .then((results) => {
          if (cancelled || seq !== requestSeq.current) return
          setSuggestions(results)
          setHighlight(0)
        })
        .catch(() => {
          if (!cancelled) setSuggestions([])
        })
    }, 90)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, accountId, open])

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  const visible = open && suggestions.length > 0

  const accept = (suggestion: ContactSuggestion) => {
    const next = applySuggestion(value, caret, suggestion)
    requestSeq.current++
    setSuggestions([])
    setOpen(false)
    onChange(next.value)
    // The value lands via props, so the caret has to be restored after React
    // has written it back into the DOM.
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(next.caret, next.caret)
      setCaret(next.caret)
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // ⌘/Ctrl+↵ is send, and stays send even with the list open — swallowing it
    // to accept a suggestion would make the shortcut unreliable.
    if (!visible || ((event.metaKey || event.ctrlKey) && event.key === 'Enter')) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((h) => (h + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      // Enter would otherwise send the message and Tab would leave the field,
      // both of which lose the suggestion the user was looking at.
      event.preventDefault()
      event.stopPropagation()
      accept(suggestions[highlight])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      requestSeq.current++
      setOpen(false)
      setSuggestions([])
    }
  }

  const syncCaret = () => {
    const position = inputRef.current?.selectionStart
    if (typeof position === 'number') setCaret(position)
  }

  return (
    <div className="recipient-input" ref={containerRef}>
      <input
        ref={inputRef}
        className="compose-input"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-autocomplete="list"
        aria-controls="recipient-suggestions"
        onChange={(e) => {
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setOpen(true)
          onChange(e.target.value)
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onFocus={syncCaret}
        onBlur={() => setOpen(false)}
      />
      {visible && (
        <ul className="recipient-suggestions" id="recipient-suggestions" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.address} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`recipient-suggestion${i === highlight ? ' is-active' : ''}`}
                // mousedown, not click: blur fires first on click and would
                // close the list before the choice registers.
                onMouseDown={(e) => {
                  e.preventDefault()
                  accept(s)
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                <span className="recipient-suggestion-main">
                  {s.name && <span className="recipient-suggestion-name">{s.name}</span>}
                  <span className="recipient-suggestion-address">{s.address}</span>
                </span>
                {s.sentCount > 0 && (
                  <span
                    className="recipient-suggestion-count"
                    title={`You've written to this address ${s.sentCount} time${
                      s.sentCount === 1 ? '' : 's'
                    }`}
                  >
                    ↑{s.sentCount}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
